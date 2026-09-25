use super::{dimensions, Exit, Output};
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io::{Read, Write},
    mem::{size_of, zeroed},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Path, PathBuf},
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{ERROR_BROKEN_PIPE, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::{
        Console::{ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON},
        JobObjects::*,
        Pipes::{CreatePipe, PeekNamedPipe},
        Threading::*,
        IO::CancelSynchronousIo,
    },
};

const TICK: Duration = Duration::from_millis(10);
type Failure = Arc<Mutex<Option<String>>>;
type Resize = (u16, u16, SyncSender<Result<(), String>>);

fn error(context: &str) -> String {
    format!("{context}: {}", std::io::Error::last_os_error())
}
fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn shell_directory(path: &Path) -> PathBuf {
    let encoded: Vec<_> = path.as_os_str().encode_wide().collect();
    // canonicalize returns verbatim paths. cmd interprets even \\?\C:\ as UNC.
    // Remove only the filesystem prefix; preserve Unicode and the absolute path.
    match path.components().next() {
        Some(std::path::Component::Prefix(prefix)) => match prefix.kind() {
            std::path::Prefix::VerbatimDisk(_) => PathBuf::from(OsString::from_wide(&encoded[4..])),
            std::path::Prefix::VerbatimUNC(_, _) => {
                let mut unc = vec![b'\\' as u16, b'\\' as u16];
                unc.extend_from_slice(&encoded[8..]);
                PathBuf::from(OsString::from_wide(&unc))
            }
            _ => path.to_path_buf(),
        },
        _ => path.to_path_buf(),
    }
}
fn handle(value: &OwnedHandle) -> HANDLE {
    value.as_raw_handle() as HANDLE
}
fn fail(failure: &Failure, message: String) {
    let mut failure = failure.lock().unwrap_or_else(|e| e.into_inner());
    if failure.is_none() {
        *failure = Some(message);
    }
}

// Only search PATH, never the project directory (which can contain an untrusted pwsh.exe).
fn find_shell(name: &OsStr) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.is_absolute() {
        return path.is_file().then(|| path.to_path_buf());
    }
    if path.components().count() != 1 {
        return None;
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .filter(|directory| directory.is_absolute())
            .map(|directory| directory.join(path))
            .find(|candidate| candidate.is_file())
    })
}

fn select_shell(
    mut find: impl FnMut(&OsStr) -> Option<PathBuf>,
    comspec: Option<&OsStr>,
) -> Result<PathBuf, String> {
    for name in [
        Some(OsStr::new("pwsh.exe")),
        Some(OsStr::new("powershell.exe")),
        comspec,
        Some(OsStr::new("cmd.exe")),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(path) = find(name) {
            return Ok(path);
        }
    }
    Err("Nenhum shell local foi encontrado (pwsh, PowerShell ou cmd).".into())
}

fn pipe() -> Result<(OwnedHandle, OwnedHandle), String> {
    let (mut read, mut write) = (null_mut(), null_mut());
    // Non-inheritable handles. ConPTY owns its ends; child handle inheritance stays disabled.
    if unsafe { CreatePipe(&mut read, &mut write, null(), 0) } == 0 {
        return Err(error("Falha ao criar pipe do terminal"));
    }
    Ok(unsafe {
        (
            OwnedHandle::from_raw_handle(read),
            OwnedHandle::from_raw_handle(write),
        )
    })
}

struct Attributes {
    storage: Vec<usize>,
}
impl Attributes {
    fn new(console: HPCON) -> Result<Self, String> {
        let mut bytes = 0;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut bytes);
        }
        if bytes == 0 {
            return Err(error("Falha ao dimensionar atributos do processo"));
        }
        // usize storage supplies the alignment required by the opaque attribute list.
        let mut storage = vec![0usize; (bytes + size_of::<usize>() - 1) / size_of::<usize>()];
        if unsafe {
            InitializeProcThreadAttributeList(storage.as_mut_ptr().cast(), 1, 0, &mut bytes)
        } == 0
        {
            return Err(error("Falha ao inicializar atributos do processo"));
        }
        let mut attrs = Self { storage };
        // PSEUDOCONSOLE takes the HPCON value itself, not a pointer to that value.
        if unsafe {
            UpdateProcThreadAttribute(
                attrs.ptr(),
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                console as *const _,
                size_of::<HPCON>(),
                null_mut(),
                null(),
            )
        } == 0
        {
            return Err(error("Falha ao associar o pseudoterminal"));
        }
        Ok(attrs)
    }
    fn ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.storage.as_mut_ptr().cast()
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.ptr());
        }
    }
}

// Owns every OS resource and IO worker, including during partially completed starts.
// ClosePseudoConsole can block until output is drained, so the reader outlives it.
// https://learn.microsoft.com/windows/console/creating-a-pseudoconsole-session
struct Native {
    console: Option<HPCON>,
    job: Option<OwnedHandle>,
    process: Option<OwnedHandle>,
    reader: Option<JoinHandle<()>>,
    writer: Option<JoinHandle<()>>,
    stop: Arc<AtomicBool>,
    drain_done: Arc<AtomicBool>,
    failure: Failure,
}

impl Native {
    fn start(
        project: &Path,
        cols: u16,
        rows: u16,
        shell: &Path,
        arguments: &str,
        output: Output,
        input: Receiver<Vec<u8>>,
        stop: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        dimensions(cols, rows)?;
        let project = shell_directory(project);
        if shell
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("cmd.exe"))
            && !matches!(project.components().next(), Some(std::path::Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_)))
        {
            return Err("O cmd não suporta este caminho como diretório atual. Instale PowerShell para usar este projeto no terminal.".into());
        }
        let mut native = Self {
            console: None,
            job: None,
            process: None,
            reader: None,
            writer: None,
            stop,
            drain_done: Arc::new(AtomicBool::new(false)),
            failure: Arc::new(Mutex::new(None)),
        };
        let (input_read, input_write) = pipe()?;
        let (output_read, output_write) = pipe()?;
        // Drain before creating the console, including all error/partial-start paths.
        let drain_done = Arc::clone(&native.drain_done);
        let stopping = Arc::clone(&native.stop);
        let failure = Arc::clone(&native.failure);
        native.reader = Some(
            thread::Builder::new()
                .name("terminal-output".into())
                .spawn(move || {
                    let mut file = File::from(output_read);
                    let mut buffer = [0u8; 8192];
                    let mut deliver = true;
                    loop {
                        let mut available = 0;
                        let ok = unsafe {
                            PeekNamedPipe(
                                file.as_raw_handle(),
                                null_mut(),
                                0,
                                null_mut(),
                                &mut available,
                                null_mut(),
                            )
                        };
                        if ok == 0 {
                            if std::io::Error::last_os_error().raw_os_error()
                                != Some(ERROR_BROKEN_PIPE as i32)
                            {
                                fail(&failure, error("Falha na leitura do terminal"));
                                stopping.store(true, Ordering::SeqCst);
                            }
                            break;
                        }
                        if available == 0 {
                            if drain_done.load(Ordering::SeqCst) {
                                break;
                            }
                            thread::sleep(TICK);
                            continue;
                        }
                        let count = (available as usize).min(buffer.len());
                        // A single reader and PeekNamedPipe ensure this read never waits for bytes.
                        match file.read(&mut buffer[..count]) {
                            Ok(0) => break,
                            Ok(count) => {
                                if deliver && !output(buffer[..count].to_vec()) {
                                    deliver = false;
                                    fail(
                                        &failure,
                                        "O canal de saída do terminal foi fechado.".into(),
                                    );
                                    stopping.store(true, Ordering::SeqCst);
                                    // Keep draining so ClosePseudoConsole cannot deadlock.
                                }
                            }
                            Err(e) => {
                                fail(&failure, format!("Falha na leitura do terminal: {e}"));
                                stopping.store(true, Ordering::SeqCst);
                                break;
                            }
                        }
                    }
                })
                .map_err(|e| format!("Falha ao iniciar leitura do terminal: {e}"))?,
        );

        let mut console = 0;
        let result = unsafe {
            CreatePseudoConsole(
                COORD {
                    X: cols as i16,
                    Y: rows as i16,
                },
                handle(&input_read),
                handle(&output_write),
                0,
                &mut console,
            )
        };
        if result < 0 {
            return Err(format!("Falha ao criar ConPTY: 0x{:08X}", result as u32));
        }
        native.console = Some(console);

        let job = unsafe { CreateJobObjectW(null(), null()) };
        if job.is_null() {
            return Err(error("Falha ao criar grupo de processos"));
        }
        native.job = Some(unsafe { OwnedHandle::from_raw_handle(job) });
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(error("Falha ao configurar encerramento dos processos"));
        }

        let mut attrs = Attributes::new(console)?;
        let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        // Without explicit invalid stdio, redirected handles from a console parent
        // can bypass ConPTY, even with bInheritHandles=false (also affects dev/tests).
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
        startup.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
        startup.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
        startup.lpAttributeList = attrs.ptr();
        let application = wide(shell.as_os_str());
        let mut command = wide(OsStr::new(&format!("\"{}\" {arguments}", shell.display())));
        let cwd = wide(project.as_os_str());
        let mut process: PROCESS_INFORMATION = unsafe { zeroed() };
        // No shell code can run before job assignment; descendants inherit this job.
        if unsafe {
            CreateProcessW(
                application.as_ptr(),
                command.as_mut_ptr(),
                null(),
                null(),
                0,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
                null(),
                cwd.as_ptr(),
                &startup.StartupInfo,
                &mut process,
            )
        } == 0
        {
            return Err(error("Falha ao iniciar shell"));
        }
        native.process = Some(unsafe { OwnedHandle::from_raw_handle(process.hProcess) });
        let main_thread = unsafe { OwnedHandle::from_raw_handle(process.hThread) };
        if unsafe { AssignProcessToJobObject(job, process.hProcess) } == 0 {
            return Err(error("Falha ao associar shell ao grupo de processos"));
        }
        drop(input_read);
        drop(output_write);

        let stopping = Arc::clone(&native.stop);
        let failure = Arc::clone(&native.failure);
        native.writer = Some(
            thread::Builder::new()
                .name("terminal-input".into())
                .spawn(move || {
                    let mut file = File::from(input_write);
                    while !stopping.load(Ordering::SeqCst) {
                        match input.recv_timeout(TICK) {
                            Ok(data) => {
                                if stopping.load(Ordering::SeqCst) {
                                    break;
                                }
                                if let Err(e) = file.write_all(&data) {
                                    if !stopping.load(Ordering::SeqCst) {
                                        fail(
                                            &failure,
                                            format!("Falha na escrita do terminal: {e}"),
                                        );
                                    }
                                    stopping.store(true, Ordering::SeqCst);
                                    break;
                                }
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {}
                            Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        }
                    }
                })
                .map_err(|e| format!("Falha ao iniciar escrita do terminal: {e}"))?,
        );
        if unsafe { ResumeThread(handle(&main_thread)) } == u32::MAX {
            return Err(error("Falha ao liberar execução do shell"));
        }
        Ok(native)
    }

    fn exited(&self) -> Result<Option<u32>, String> {
        let process = self
            .process
            .as_ref()
            .ok_or("Processo do terminal indisponível.")?;
        match unsafe { WaitForSingleObject(handle(process), 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let mut code = 0;
                if unsafe { GetExitCodeProcess(handle(process), &mut code) } == 0 {
                    return Err(error("Falha ao obter saída do shell"));
                }
                Ok(Some(code))
            }
            _ => Err(error("Falha ao consultar shell")),
        }
    }

    fn cleanup(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(job) = self.job.take() {
            // Closing the last job handle also enforces KILL_ON_JOB_CLOSE if termination fails.
            unsafe {
                TerminateJobObject(handle(&job), 1);
            }
            drop(job);
        }
        if let Some(process) = self.process.take() {
            // Also covers failure before AssignProcessToJobObject succeeds.
            if unsafe { WaitForSingleObject(handle(&process), 0) } == WAIT_TIMEOUT {
                if unsafe { TerminateProcess(handle(&process), 1) } == 0
                    && unsafe { WaitForSingleObject(handle(&process), 0) } != WAIT_OBJECT_0
                {
                    fail(&self.failure, error("Falha ao encerrar shell"));
                }
            }
            if unsafe { WaitForSingleObject(handle(&process), 5000) } != WAIT_OBJECT_0 {
                fail(
                    &self.failure,
                    "O shell não confirmou seu encerramento.".into(),
                );
            }
        }
        if let Some(writer) = self.writer.take() {
            // Repeated cancellation closes the race between checking stop and entering WriteFile.
            while !writer.is_finished() {
                unsafe {
                    CancelSynchronousIo(writer.as_raw_handle());
                }
                thread::sleep(TICK);
            }
            if writer.join().is_err() {
                fail(
                    &self.failure,
                    "A escrita do terminal foi interrompida.".into(),
                );
            }
        }
        if let Some(console) = self.console.take() {
            unsafe {
                ClosePseudoConsole(console);
            }
        }
        self.drain_done.store(true, Ordering::SeqCst);
        if let Some(reader) = self.reader.take() {
            if reader.join().is_err() {
                fail(
                    &self.failure,
                    "A leitura do terminal foi interrompida.".into(),
                );
            }
        }
    }
}
impl Drop for Native {
    fn drop(&mut self) {
        self.cleanup();
    }
}

pub(super) struct Session {
    stop: Arc<AtomicBool>,
    input: SyncSender<Vec<u8>>,
    resize: SyncSender<Resize>,
    worker: Option<JoinHandle<()>>,
}

impl Session {
    pub(super) fn start(
        project: &Path,
        cols: u16,
        rows: u16,
        output: Output,
        exit: Exit,
    ) -> Result<Self, String> {
        let shell = select_shell(find_shell, std::env::var_os("COMSPEC").as_deref())?;
        Self::with_shell(project, cols, rows, &shell, "", output, exit)
    }

    fn with_shell(
        project: &Path,
        cols: u16,
        rows: u16,
        shell: &Path,
        arguments: &str,
        output: Output,
        exit: Exit,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (input, input_rx) = mpsc::sync_channel(64);
        let (resize, resize_rx) = mpsc::sync_channel::<Resize>(16);
        let mut native = Native::start(
            project,
            cols,
            rows,
            shell,
            arguments,
            output,
            input_rx,
            Arc::clone(&stop),
        )?;
        let worker = thread::Builder::new()
            .name("terminal-session".into())
            .spawn(move || {
                let mut code = None;
                while !native.stop.load(Ordering::SeqCst) {
                    match native.exited() {
                        Ok(Some(value)) => {
                            code = Some(value);
                            break;
                        }
                        Ok(None) => {}
                        Err(e) => {
                            fail(&native.failure, e);
                            break;
                        }
                    }
                    match resize_rx.recv_timeout(TICK) {
                        Ok((cols, rows, reply)) => {
                            let result = native.console.map(|console| unsafe {
                                ResizePseudoConsole(
                                    console,
                                    COORD {
                                        X: cols as i16,
                                        Y: rows as i16,
                                    },
                                )
                            });
                            let _ = reply.send(match result {
                                Some(hr) if hr >= 0 => Ok(()),
                                Some(hr) => Err(format!(
                                    "Falha ao redimensionar terminal: 0x{:08X}",
                                    hr as u32
                                )),
                                None => Err("A sessão do terminal terminou.".into()),
                            });
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                native.cleanup();
                let error = native
                    .failure
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                exit(code, error);
            })
            .map_err(|e| format!("Falha ao supervisionar terminal: {e}"))?;
        Ok(Self {
            stop,
            input,
            resize,
            worker: Some(worker),
        })
    }

    pub(super) fn input(&self, data: Vec<u8>) -> Result<(), String> {
        if self.stop.load(Ordering::SeqCst) {
            return Err("A sessão do terminal terminou.".into());
        }
        self.input.try_send(data).map_err(|e| match e {
            mpsc::TrySendError::Full(_) => {
                "O terminal está ocupado; tente enviar a entrada novamente.".into()
            }
            mpsc::TrySendError::Disconnected(_) => "A sessão do terminal terminou.".into(),
        })
    }

    pub(super) fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        dimensions(cols, rows)?;
        if self.stop.load(Ordering::SeqCst) {
            return Err("A sessão do terminal terminou.".into());
        }
        let (reply, result) = mpsc::sync_channel(1);
        self.resize
            .try_send((cols, rows, reply))
            .map_err(|_| "A sessão não pode ser redimensionada agora.")?;
        result
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "O terminal não respondeu ao redimensionamento.".to_string())?
    }

    pub(super) fn stop(&mut self) -> Result<(), String> {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            worker
                .join()
                .map_err(|_| "A supervisão do terminal foi interrompida.")?;
        }
        Ok(())
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    enum Event {
        Output(Vec<u8>),
        Exit(Option<u32>, Option<String>),
    }

    fn start(arguments: &str, project: &Path) -> (Session, Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        let output = tx.clone();
        let shell = find_shell(OsStr::new("cmd.exe")).unwrap();
        let session = Session::with_shell(
            project,
            160,
            30,
            &shell,
            arguments,
            Arc::new(move |data| output.send(Event::Output(data)).is_ok()),
            Box::new(move |code, error| {
                let _ = tx.send(Event::Exit(code, error));
            }),
        )
        .unwrap();
        (session, rx)
    }

    fn until(rx: &Receiver<Event>, predicate: impl Fn(&str) -> bool) -> String {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut bytes = Vec::new();
        loop {
            match rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("PTY output timed out")
            {
                Event::Output(data) => {
                    bytes.extend(data);
                    let text = String::from_utf8_lossy(&bytes);
                    if predicate(&text) {
                        return text.into_owned();
                    }
                }
                Event::Exit(code, error) => panic!("Shell exited too early: {code:?} {error:?}"),
            }
        }
    }

    fn exit_event(rx: &Receiver<Event>) -> (String, Option<u32>, Option<String>) {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut bytes = Vec::new();
        loop {
            match rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("PTY exit timed out")
            {
                Event::Output(data) => bytes.extend(data),
                Event::Exit(code, error) => {
                    return (String::from_utf8_lossy(&bytes).into_owned(), code, error)
                }
            }
        }
    }

    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("corant-pty-{}-{suffix}-espaço", std::process::id()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.0);
        }
    }

    #[test]
    fn shell_priority() {
        let names = ["pwsh.exe", "powershell.exe", "custom.exe", "cmd.exe"];
        for index in 0..names.len() {
            let selected = select_shell(
                |name| {
                    names[index..]
                        .iter()
                        .find(|candidate| OsStr::new(candidate) == name)
                        .map(PathBuf::from)
                },
                Some(OsStr::new("custom.exe")),
            )
            .unwrap();
            assert_eq!(selected, PathBuf::from(names[index]));
        }
        assert!(select_shell(|_| None, None).is_err());
    }

    #[test]
    fn real_pty_input_cwd_resize_and_natural_exit() {
        let directory = Directory::new();
        let canonical = directory.0.canonicalize().unwrap();
        let (mut session, events) = start("/d /q", &canonical);
        session.resize(101, 37).unwrap();
        // cmd /q disables command echo, so these markers must come from the shell.
        session.input(b"echo PTY-READY\r\n".to_vec()).unwrap();
        until(&events, |s| s.contains("PTY-READY"));
        session
            .input(b"echo CWD=%CD%\r\nexit /b 7\r\n".to_vec())
            .unwrap();
        let (output, code, error) = exit_event(&events);
        assert_eq!(code, Some(7), "{output} {error:?}");
        assert_eq!(error, None);
        assert!(
            output.contains(&directory.0.to_string_lossy().to_string()),
            "Unexpected cwd: {output}"
        );
        assert!(session.input(b"ignored".to_vec()).is_err());
        session.stop().unwrap();
        session.stop().unwrap();
    }

    #[test]
    fn stop_cancels_full_input_and_drains_flooded_output() {
        let directory = Directory::new();
        let (mut session, _events) = start("/d /q /c ping -n 90 127.0.0.1 >nul", &directory.0);
        for _ in 0..64 {
            let _ = session.input(vec![b'x'; 16 * 1024]);
        }
        thread::sleep(Duration::from_millis(100));
        let began = Instant::now();
        session.stop().unwrap();
        assert!(began.elapsed() < Duration::from_secs(5));

        let (mut session, events) = start(
            "/d /q /c for /l %i in (1,1,1000000) do @echo FLOOD-OUTPUT-0123456789",
            &directory.0,
        );
        until(&events, |s| s.len() > 32 * 1024);
        let began = Instant::now();
        session.stop().unwrap();
        assert!(began.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn failed_start_cleans_up_and_allows_retry() {
        let directory = Directory::new();
        for _ in 0..3 {
            assert!(Session::with_shell(
                &directory.0,
                80,
                24,
                &directory.0.join("missing-shell.exe"),
                "",
                Arc::new(|_| true),
                Box::new(|_, _| {})
            )
            .is_err());
        }
        let (mut session, events) = start("/d /q /c exit 0", &directory.0);
        assert_eq!(exit_event(&events).1, Some(0));
        session.stop().unwrap();
    }

    #[test]
    fn descendants_die_on_stop_and_on_natural_shell_exit() {
        let directory = Directory::new();
        let shell = find_shell(OsStr::new("powershell.exe")).unwrap();
        for natural in [false, true] {
            let (tx, rx) = mpsc::channel();
            let output = tx.clone();
            let delay = if natural { "1" } else { "90" };
            let arguments = format!("-NoLogo -NoProfile -Command \"$p = Start-Process -FilePath $env:COMSPEC -ArgumentList '/d /c ping -n 90 127.0.0.1 >nul' -WindowStyle Hidden -PassThru; [Console]::WriteLine('CHILDID:' + $p.Id + ':END'); Start-Sleep {delay}; exit 3\"");
            let mut session = Session::with_shell(
                &directory.0,
                160,
                30,
                &shell,
                &arguments,
                Arc::new(move |data| output.send(Event::Output(data)).is_ok()),
                Box::new(move |code, error| {
                    let _ = tx.send(Event::Exit(code, error));
                }),
            )
            .unwrap();
            let output = until(&rx, |s| s.contains(":END"));
            let pid: u32 = output
                .split("CHILDID:")
                .nth(1)
                .unwrap()
                .split(":END")
                .next()
                .unwrap()
                .parse()
                .unwrap();
            let child = unsafe {
                OpenProcess(
                    PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    pid,
                )
            };
            assert!(!child.is_null(), "Could not open child {pid}");
            let child = unsafe { OwnedHandle::from_raw_handle(child) };
            assert_eq!(
                unsafe { WaitForSingleObject(handle(&child), 0) },
                WAIT_TIMEOUT
            );
            if natural {
                assert_eq!(exit_event(&rx).1, Some(3));
            }
            session.stop().unwrap();
            assert_eq!(
                unsafe { WaitForSingleObject(handle(&child), 1000) },
                WAIT_OBJECT_0,
                "Descendant survived terminal cleanup"
            );
        }
    }
}

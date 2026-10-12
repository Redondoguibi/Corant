use crate::native_plugins::{export_bytes, relative_file, NativePlugins};
use std::io::{Cursor, Read};
use tauri::Manager;
use tiff::{
    decoder::{Decoder, DecodingResult, Limits},
    ColorType,
};
const MAX_PIXELS: u64 = 16_000_000;

fn dimensions(w: u32, h: u32) -> Result<(), String> {
    if w == 0 || h == 0 || w > 16384 || h > 16384 || u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err("Use uma imagem de até 16 megapixels e 16.384 pixels por dimensão.".into());
    }
    Ok(())
}
fn error(e: impl std::fmt::Display) -> String {
    format!("Não foi possível processar a imagem: {e}")
}

fn tiff_to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut limits = Limits::default();
    limits.decoding_buffer_size = 128 * 1024 * 1024;
    limits.intermediate_buffer_size = 64 * 1024 * 1024;
    limits.ifd_value_size = 1024 * 1024;
    let mut decoder = Decoder::new(Cursor::new(bytes))
        .map_err(error)?
        .with_limits(limits);
    let (w, h) = decoder.dimensions().map_err(error)?;
    dimensions(w, h)?;
    let color = decoder.colortype().map_err(error)?;
    let channels = match color {
        ColorType::RGB(8 | 16) => 3,
        ColorType::RGBA(8 | 16) | ColorType::CMYK(8) => 4,
        ColorType::Gray(8 | 16) => 1,
        ColorType::GrayA(8 | 16) => 2,
        _ => {
            return Err(
                "TIFF não suportado. Use RGB ou tons de cinza de 8/16 bits, ou CMYK de 8 bits."
                    .into(),
            )
        }
    };
    let orientation = decoder
        .get_tag_u32(tiff::tags::Tag::Orientation)
        .unwrap_or(1);
    let associated_alpha = decoder
        .get_tag_u16_vec(tiff::tags::Tag::ExtraSamples)
        .ok()
        .is_some_and(|v| v.first() == Some(&1));
    let samples = match decoder.read_image().map_err(error)? {
        DecodingResult::U8(v) => v,
        DecodingResult::U16(v) => v.into_iter().map(|v| (v >> 8) as u8).collect(),
        _ => return Err("Tipo de amostra TIFF não suportado.".into()),
    };
    if samples.len() != w as usize * h as usize * channels {
        return Err("Dados TIFF incompletos.".into());
    }
    let mut rgba = Vec::with_capacity(w as usize * h as usize * 4);
    for p in samples.chunks_exact(channels) {
        let mut out = match color {
            ColorType::RGB(_) => [p[0], p[1], p[2], 255],
            ColorType::RGBA(_) => [p[0], p[1], p[2], p[3]],
            ColorType::Gray(_) => [p[0], p[0], p[0], 255],
            ColorType::GrayA(_) => [p[0], p[0], p[0], p[1]],
            ColorType::CMYK(_) => [
                (((255 - p[0]) as u16 * (255 - p[3]) as u16) / 255) as u8,
                (((255 - p[1]) as u16 * (255 - p[3]) as u16) / 255) as u8,
                (((255 - p[2]) as u16 * (255 - p[3]) as u16) / 255) as u8,
                255,
            ],
            _ => unreachable!(),
        };
        if associated_alpha && out[3] > 0 {
            for i in 0..3 {
                out[i] = (u32::from(out[i]) * 255 / u32::from(out[3])).min(255) as u8;
            }
        }
        rgba.extend_from_slice(&out);
    }
    let (ow, oh) = if (5..=8).contains(&orientation) {
        (h, w)
    } else {
        (w, h)
    };
    let mut oriented = vec![0; rgba.len()];
    for y in 0..h {
        for x in 0..w {
            let (dx, dy) = match orientation {
                2 => (w - 1 - x, y),
                3 => (w - 1 - x, h - 1 - y),
                4 => (x, h - 1 - y),
                5 => (y, x),
                6 => (h - 1 - y, x),
                7 => (h - 1 - y, w - 1 - x),
                8 => (y, w - 1 - x),
                _ => (x, y),
            };
            let src = ((y * w + x) * 4) as usize;
            let dst = ((dy * ow + dx) * 4) as usize;
            oriented[dst..dst + 4].copy_from_slice(&rgba[src..src + 4]);
        }
    }
    let mut result = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut result, ow, oh);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .map_err(error)?
            .write_image_data(&oriented)
            .map_err(error)?;
    }
    Ok(result)
}
fn png_to_tiff(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: 128 * 1024 * 1024,
    });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(error)?;
    dimensions(reader.info().width, reader.info().height)?;
    let mut pixels = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut pixels).map_err(error)?;
    let pixels = &pixels[..frame.buffer_size()];
    let mut rgba = Vec::with_capacity(frame.width as usize * frame.height as usize * 4);
    for p in pixels.chunks_exact(frame.color_type.samples()) {
        match frame.color_type {
            png::ColorType::Rgba => rgba.extend_from_slice(p),
            png::ColorType::Rgb => rgba.extend_from_slice(&[p[0], p[1], p[2], 255]),
            png::ColorType::Grayscale => rgba.extend_from_slice(&[p[0], p[0], p[0], 255]),
            png::ColorType::GrayscaleAlpha => rgba.extend_from_slice(&[p[0], p[0], p[0], p[1]]),
            _ => return Err("PNG inválido para exportação TIFF.".into()),
        }
    }
    let mut cursor = Cursor::new(Vec::new());
    tiff::encoder::TiffEncoder::new(&mut cursor)
        .map_err(error)?
        .write_image::<tiff::encoder::colortype::RGBA8>(frame.width, frame.height, &rgba)
        .map_err(error)?;
    Ok(cursor.into_inner())
}
#[tauri::command]
pub async fn image_read_tiff(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_path: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if window.label() != "main" {
        return Err("Janela não autorizada.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativePlugins>()
            .with_project(&project_path, |root| {
                let file = relative_file(root, &path)?;
                let mut bytes = Vec::new();
                std::fs::File::open(file)
                    .map_err(error)?
                    .take(80 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(error)?;
                if bytes.len() > 80 * 1024 * 1024 {
                    return Err("O TIFF excede 80 MiB.".into());
                }
                tiff_to_png(&bytes).map(tauri::ipc::Response::new)
            })
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub async fn image_export(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_path: String,
    name: String,
    data: Vec<u8>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Janela não autorizada.".into());
    }
    if data.len() > 80 * 1024 * 1024 {
        return Err("A exportação excede 80 MiB.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        let valid = match extension.as_str() {
            "png" | "tif" | "tiff" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
            "jpg" | "jpeg" => data.starts_with(&[255, 216, 255]),
            "webp" => data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP"),
            _ => false,
        };
        if !valid {
            return Err("Formato de exportação inválido.".into());
        }
        let bytes = if extension == "tif" || extension == "tiff" {
            png_to_tiff(&data)?
        } else {
            data
        };
        app.state::<NativePlugins>()
            .with_project(&project_path, |root| export_bytes(root, &name, &bytes))
    })
    .await
    .map_err(error)?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tiff_rgba_roundtrip_preserves_dimensions_and_pixels() {
        let mut data = Cursor::new(Vec::new());
        let original = [255, 0, 0, 255, 0, 180, 40, 128];
        tiff::encoder::TiffEncoder::new(&mut data)
            .unwrap()
            .write_image::<tiff::encoder::colortype::RGBA8>(2, 1, &original)
            .unwrap();
        let png = tiff_to_png(&data.into_inner()).unwrap();
        let tiff = png_to_tiff(&png).unwrap();
        let mut decoder = Decoder::new(Cursor::new(tiff)).unwrap();
        assert_eq!(decoder.dimensions().unwrap(), (2, 1));
        match decoder.read_image().unwrap() {
            DecodingResult::U8(v) => assert_eq!(v, original),
            _ => panic!("wrong sample type"),
        }
    }
    #[test]
    fn rejects_invalid_and_oversized_images() {
        assert!(tiff_to_png(b"not tiff").is_err());
        assert!(png_to_tiff(b"not png").is_err());
        assert!(dimensions(16000, 16000).is_err());
        assert!(dimensions(0, 100).is_err());
    }
    #[test]
    fn converts_gray16_and_honors_orientation() {
        let mut data = Cursor::new(Vec::new());
        {
            let mut encoder = tiff::encoder::TiffEncoder::new(&mut data).unwrap();
            let mut image = encoder
                .new_image::<tiff::encoder::colortype::Gray16>(2, 1)
                .unwrap();
            image
                .encoder()
                .write_tag(tiff::tags::Tag::Orientation, 6u16)
                .unwrap();
            image.write_data(&[0, 65535]).unwrap();
        }
        let png = tiff_to_png(&data.into_inner()).unwrap();
        let mut reader = png::Decoder::new(Cursor::new(png)).read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (1, 2));
        let mut pixels = vec![0; reader.output_buffer_size()];
        reader.next_frame(&mut pixels).unwrap();
        assert_eq!(pixels, vec![0, 0, 0, 255, 255, 255, 255, 255]);
    }
}

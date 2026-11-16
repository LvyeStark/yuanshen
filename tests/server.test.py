import unittest
from pathlib import Path

import server


class ServerConfigurationTests(unittest.TestCase):
    def test_ffmpeg_command_uses_h265_mp4_and_exact_dimensions(self):
        output = Path("outputs/test.mp4")
        command = server.build_ffmpeg_command(8256, 5504, 30, output)
        joined = " ".join(map(str, command))

        self.assertIn("libx265", command)
        self.assertIn("hvc1", command)
        self.assertIn("scale=8256:5504:flags=lanczos,setsar=1,format=yuv420p", command)
        self.assertIn("-f mp4", joined)
        self.assertEqual(command[-1], str(output))

    def test_ffmpeg_binary_is_project_local(self):
        ffmpeg_path = Path(server.FFMPEG_EXE).resolve()
        self.assertTrue(ffmpeg_path.is_file())
        self.assertTrue(ffmpeg_path.is_relative_to(server.VENDOR.resolve()))

    def test_camera_resolution_is_within_server_safety_limit(self):
        self.assertLessEqual(8256 * 5504, server.MAX_PIXELS)

    def test_output_name_is_derived_from_the_original_media_name(self):
        self.assertEqual(
            server.build_output_file_name("IMG_8256.HEIC"),
            "IMG_8256.mp4",
        )
        self.assertEqual(
            server.build_output_file_name(r"C:\Camera\旅拍:夜景.JPG"),
            "旅拍-夜景.mp4",
        )
        self.assertEqual(
            server.build_output_file_name("IMG_8256.HEIC", "livephoto"),
            "IMG_8256-livephoto.zip",
        )

    def test_live_photo_helper_writes_apple_pairing_metadata(self):
        helper_source = (server.ROOT / "tools" / "live-photo-pair.swift").read_text()
        self.assertIn("com.apple.quicktime.content.identifier", helper_source)
        self.assertIn("com.apple.quicktime.still-image-time", helper_source)
        self.assertIn('makerApple["17"]', helper_source)
        self.assertIn('"-a", "Photos"', (server.ROOT / "server.py").read_text())

    def test_ffmpeg_command_writes_source_metadata_into_mp4(self):
        output = Path("outputs/test.mp4")
        command = server.build_ffmpeg_command(
            1920,
            1080,
            30,
            output,
            metadata={
                "original_filename": "IMG_8256.HEIC",
                "creation_time": "2026-11-15T12:00:00Z",
            },
        )
        self.assertIn("+faststart+use_metadata_tags", command)
        self.assertIn("original_filename=IMG_8256.HEIC", command)
        self.assertIn("creation_time=2026-11-15T12:00:00Z", command)


if __name__ == "__main__":
    unittest.main()

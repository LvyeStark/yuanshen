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
        self.assertIn("scale=8256:5504:flags=lanczos,format=yuv420p", command)
        self.assertIn("-f mp4", joined)
        self.assertEqual(command[-1], str(output))

    def test_ffmpeg_binary_is_project_local(self):
        ffmpeg_path = Path(server.FFMPEG_EXE).resolve()
        self.assertTrue(ffmpeg_path.is_file())
        self.assertTrue(ffmpeg_path.is_relative_to(server.VENDOR.resolve()))

    def test_camera_resolution_is_within_server_safety_limit(self):
        self.assertLessEqual(8256 * 5504, server.MAX_PIXELS)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Local static server plus streaming H.265 MP4 export service."""

from __future__ import annotations

import argparse
import atexit
import json
import os
import re
import subprocess
import sys
import threading
import uuid
from collections import deque
from datetime import datetime
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
OUTPUTS = ROOT / "outputs"
MAX_FRAME_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 150_000_000

sys.path.insert(0, str(VENDOR))

try:
    import imageio_ffmpeg
except ImportError as error:  # pragma: no cover - exercised when setup is incomplete
    raise SystemExit(
        "缺少项目内 FFmpeg：请运行 "
        "python3 -m pip install --target ./vendor imageio-ffmpeg"
    ) from error


FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


class ExportError(RuntimeError):
    """Expected export failure that can be shown to the browser."""


class ExportSession:
    def __init__(self, width: int, height: int, fps: int, frame_count: int) -> None:
        self.session_id = uuid.uuid4().hex
        self.width = width
        self.height = height
        self.fps = fps
        self.frame_count = frame_count
        self.received_frames = 0
        self.lock = threading.Lock()
        self.stderr_tail: deque[str] = deque(maxlen=24)

        OUTPUTS.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.file_name = f"task-overlay-video-{stamp}-{width}x{height}.mp4"
        self.output_path = OUTPUTS / self.file_name
        self.partial_path = OUTPUTS / f".{self.session_id}.partial.mp4"

        command = build_ffmpeg_command(
            width=width,
            height=height,
            fps=fps,
            output_path=self.partial_path,
        )
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            cwd=ROOT,
        )
        self.stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self.stderr_thread.start()

    def _drain_stderr(self) -> None:
        if self.process.stderr is None:
            return
        for raw_line in iter(self.process.stderr.readline, b""):
            line = raw_line.decode("utf-8", errors="replace").strip()
            if line:
                self.stderr_tail.append(line)

    def error_detail(self) -> str:
        return "\n".join(self.stderr_tail) or "FFmpeg 未返回详细错误。"

    def write_frame(self, frame: bytes) -> None:
        with self.lock:
            if self.process.poll() is not None:
                raise ExportError(f"FFmpeg 已停止：{self.error_detail()}")
            if self.received_frames >= self.frame_count:
                raise ExportError("收到的帧数超过了导出任务的预期帧数。")
            if self.process.stdin is None:
                raise ExportError("FFmpeg 输入管道不可用。")
            try:
                self.process.stdin.write(frame)
                self.process.stdin.flush()
            except (BrokenPipeError, OSError) as error:
                raise ExportError(f"写入 FFmpeg 失败：{self.error_detail()}") from error
            self.received_frames += 1

    def finish(self) -> Path:
        with self.lock:
            if self.received_frames != self.frame_count:
                raise ExportError(
                    f"视频帧不完整：收到 {self.received_frames}/{self.frame_count}。"
                )
            if self.process.stdin is not None and not self.process.stdin.closed:
                self.process.stdin.close()

        try:
            return_code = self.process.wait(timeout=3600)
        except subprocess.TimeoutExpired as error:
            self.cancel()
            raise ExportError("H.265 编码超时。") from error

        self.stderr_thread.join(timeout=2)
        if return_code != 0 or not self.partial_path.exists():
            self.partial_path.unlink(missing_ok=True)
            raise ExportError(f"FFmpeg 编码失败：{self.error_detail()}")

        os.replace(self.partial_path, self.output_path)
        return self.output_path

    def cancel(self) -> None:
        with self.lock:
            if self.process.stdin is not None and not self.process.stdin.closed:
                try:
                    self.process.stdin.close()
                except OSError:
                    pass
            if self.process.poll() is None:
                self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.partial_path.unlink(missing_ok=True)


def build_ffmpeg_command(width: int, height: int, fps: int, output_path: Path) -> list[str]:
    return [
        FFMPEG_EXE,
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-framerate",
        str(fps),
        "-i",
        "pipe:0",
        "-an",
        "-vf",
        f"scale={width}:{height}:flags=lanczos,format=yuv420p",
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-crf",
        "20",
        "-tag:v",
        "hvc1",
        "-movflags",
        "+faststart",
        "-x265-params",
        "log-level=error",
        "-f",
        "mp4",
        str(output_path),
    ]


class SessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, ExportSession] = {}
        self.lock = threading.Lock()

    def create(self, width: int, height: int, fps: int, frame_count: int) -> ExportSession:
        with self.lock:
            if self.sessions:
                raise ExportError("已有视频正在导出，请等待当前任务完成。")
            session = ExportSession(width, height, fps, frame_count)
            self.sessions[session.session_id] = session
            return session

    def get(self, session_id: str) -> ExportSession:
        with self.lock:
            session = self.sessions.get(session_id)
        if session is None:
            raise ExportError("视频导出任务不存在或已经结束。")
        return session

    def remove(self, session_id: str) -> ExportSession | None:
        with self.lock:
            return self.sessions.pop(session_id, None)

    def cancel_all(self) -> None:
        with self.lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        for session in sessions:
            session.cancel()


SESSIONS = SessionManager()
SESSION_ROUTE = re.compile(r"^/api/video/([0-9a-f]{32})/(frame|finish|cancel)$")


class ExportRequestHandler(SimpleHTTPRequestHandler):
    server_version = "TaskOverlayLocal/1.0"

    def send_json(self, status: HTTPStatus | int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path == "/api/health":
            self.send_json(
                HTTPStatus.OK,
                {"ok": True, "encoder": "libx265", "format": "H.265 MP4"},
            )
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        try:
            if self.path == "/api/video/start":
                self.handle_start()
                return

            match = SESSION_ROUTE.fullmatch(self.path)
            if match is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在。"})
                return

            session_id, action = match.groups()
            if action == "frame":
                self.handle_frame(session_id)
            elif action == "finish":
                self.handle_finish(session_id)
            else:
                self.handle_cancel(session_id)
        except ExportError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:  # pragma: no cover - final safety net for local UI
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"本地视频服务异常：{error}"},
            )

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 64 * 1024:
            raise ExportError("请求数据大小不正确。")
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ExportError("请求 JSON 无效。") from error

    def handle_start(self) -> None:
        payload = self.read_json()
        width = int(payload.get("width", 0))
        height = int(payload.get("height", 0))
        fps = int(payload.get("fps", 0))
        frame_count = int(payload.get("frameCount", 0))
        if width < 2 or height < 2 or width % 2 or height % 2:
            raise ExportError("视频宽高必须是大于 1 的偶数。")
        if width * height > MAX_PIXELS:
            raise ExportError("视频像素尺寸超过本地服务的安全上限。")
        if fps < 1 or fps > 60:
            raise ExportError("帧率必须在 1 到 60 之间。")
        if frame_count < 1 or frame_count > 18_000:
            raise ExportError("视频帧数超出安全范围。")

        session = SESSIONS.create(width, height, fps, frame_count)
        self.send_json(
            HTTPStatus.CREATED,
            {
                "sessionId": session.session_id,
                "width": width,
                "height": height,
                "fps": fps,
                "frameCount": frame_count,
            },
        )

    def handle_frame(self, session_id: str) -> None:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
        if content_type != "image/jpeg":
            raise ExportError("视频帧必须使用 JPEG 格式。")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_FRAME_BYTES:
            raise ExportError("视频帧大小不正确。")
        frame = self.rfile.read(length)
        if len(frame) != length or not frame.startswith(b"\xff\xd8"):
            raise ExportError("视频帧内容不完整或不是 JPEG。")
        session = SESSIONS.get(session_id)
        session.write_frame(frame)
        self.send_json(
            HTTPStatus.OK,
            {"ok": True, "receivedFrames": session.received_frames},
        )

    def handle_finish(self, session_id: str) -> None:
        session = SESSIONS.get(session_id)
        try:
            output_path = session.finish()
        except Exception:
            session.cancel()
            raise
        finally:
            SESSIONS.remove(session_id)
        relative_path = output_path.relative_to(ROOT).as_posix()
        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "width": session.width,
                "height": session.height,
                "fileName": session.file_name,
                "outputPath": relative_path,
                "downloadUrl": f"/{relative_path}",
            },
        )

    def handle_cancel(self, session_id: str) -> None:
        session = SESSIONS.remove(session_id)
        if session is not None:
            session.cancel()
        self.send_json(HTTPStatus.OK, {"ok": True})


class LocalExportServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser(description="运行本地网页与 H.265 MP4 导出服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    handler = partial(ExportRequestHandler, directory=str(ROOT))
    server = LocalExportServer((args.host, args.port), handler)
    atexit.register(SESSIONS.cancel_all)
    print(f"本地项目：http://{args.host}:{args.port}/index.html", flush=True)
    print(f"H.265 编码器：{FFMPEG_EXE}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        SESSIONS.cancel_all()
        server.server_close()


if __name__ == "__main__":
    main()

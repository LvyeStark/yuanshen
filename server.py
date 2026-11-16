#!/usr/bin/env python3
"""Local static server plus streaming H.265 MP4 export service."""

from __future__ import annotations

import argparse
import atexit
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
import zipfile
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
OUTPUTS = ROOT / "outputs"
MAX_FRAME_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 150_000_000
MAX_SOURCE_BYTES = 20 * 1024 * 1024 * 1024
SOURCE_TEMP_ROOT = Path(tempfile.mkdtemp(prefix="task-overlay-source-"))
atexit.register(shutil.rmtree, SOURCE_TEMP_ROOT, True)

sys.path.insert(0, str(VENDOR))

try:
    import imageio_ffmpeg
except ImportError as error:  # pragma: no cover - exercised when setup is incomplete
    raise SystemExit(
        "缺少项目内 FFmpeg：请运行 "
        "python3 -m pip install --target ./vendor imageio-ffmpeg"
    ) from error


FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


def clean_source_name(value: str | None) -> str:
    raw_name = str(value or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    clean_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", raw_name).strip(" .")
    return clean_name[:180] or "source-media"


def build_output_file_name(source_name: str | None, export_format: str = "mp4") -> str:
    clean_name = clean_source_name(source_name)
    stem = Path(clean_name).stem.strip(" .") or "source-media"
    if export_format == "livephoto":
        return f"{stem[:130]}-livephoto.zip"
    return f"{stem[:140]}.mp4"


def unique_output_path(file_name: str) -> Path:
    candidate = OUTPUTS / file_name
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    for index in range(2, 10_000):
        numbered = OUTPUTS / f"{stem}-{index}{candidate.suffix}"
        if not numbered.exists():
            return numbered
    raise ExportError("无法为导出视频分配不重复的文件名。")


@dataclass(frozen=True)
class SourceMedia:
    token: str
    path: Path
    original_name: str
    last_modified_ms: int | None


MDLS_METADATA_KEYS = (
    "kMDItemContentCreationDate",
    "kMDItemAcquisitionMake",
    "kMDItemAcquisitionModel",
    "kMDItemLatitude",
    "kMDItemLongitude",
    "kMDItemAltitude",
    "kMDItemPixelWidth",
    "kMDItemPixelHeight",
    "kMDItemOrientation",
    "kMDItemExposureTimeSeconds",
    "kMDItemFNumber",
    "kMDItemFocalLength",
    "kMDItemISOSpeed",
)


def _iso_datetime(value: Any) -> str | None:
    if isinstance(value, datetime):
        date_value = value
    elif value:
        try:
            date_value = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if date_value.tzinfo is None:
        date_value = date_value.replace(tzinfo=timezone.utc)
    return date_value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_macos_metadata(path: Path) -> dict[str, Any]:
    mdls = shutil.which("mdls")
    if not mdls:
        return {}
    try:
        result = subprocess.run(
            [mdls, "-plist", "-", str(path)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
        )
        payload = plistlib.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, plistlib.InvalidFileException):
        return {}
    return {key: payload[key] for key in MDLS_METADATA_KEYS if payload.get(key) is not None}


def _unescape_ffmetadata(value: str) -> str:
    return re.sub(r"\\([\\=;#])", r"\1", value)


def read_ffmpeg_metadata(path: Path) -> dict[str, str]:
    try:
        result = subprocess.run(
            [
                FFMPEG_EXE,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-map_metadata",
                "0",
                "-f",
                "ffmetadata",
                "-",
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return {}
    ignored_keys = {"major_brand", "minor_version", "compatible_brands", "encoder"}
    metadata: dict[str, str] = {}
    for line in result.stdout.decode("utf-8", errors="replace").splitlines():
        if not line or line.startswith((";", "#")) or "=" not in line:
            continue
        key, value = line.split("=", 1)
        clean_key = re.sub(r"[^A-Za-z0-9_.-]", "_", _unescape_ffmetadata(key).strip())
        if not clean_key or clean_key.lower() in ignored_keys:
            continue
        metadata[clean_key] = _unescape_ffmetadata(value).strip()
    return metadata


def build_output_metadata(source: SourceMedia | None, fallback_name: str | None) -> dict[str, str]:
    original_name = source.original_name if source else clean_source_name(fallback_name)
    metadata: dict[str, str] = read_ffmpeg_metadata(source.path) if source else {}
    metadata.update({
        "original_filename": original_name,
        "encoded_by": "Teyvat Task Overlay Studio / FFmpeg libx265",
    })
    metadata.setdefault("title", f"{Path(original_name).stem} task overlay")
    source_metadata = read_macos_metadata(source.path) if source else {}
    creation_time = _iso_datetime(source_metadata.get("kMDItemContentCreationDate"))
    if not creation_time:
        creation_time = _iso_datetime(metadata.get("creation_time"))
    if not creation_time and source and source.last_modified_ms:
        creation_time = datetime.fromtimestamp(
            source.last_modified_ms / 1000,
            tz=timezone.utc,
        ).isoformat(timespec="seconds").replace("+00:00", "Z")
    if creation_time:
        metadata["creation_time"] = creation_time
        metadata["com.apple.quicktime.creationdate"] = creation_time

    make = source_metadata.get("kMDItemAcquisitionMake")
    model = source_metadata.get("kMDItemAcquisitionModel")
    if make:
        metadata["com.apple.quicktime.make"] = str(make)
        metadata["camera_make"] = str(make)
    if model:
        metadata["com.apple.quicktime.model"] = str(model)
        metadata["camera_model"] = str(model)

    latitude = source_metadata.get("kMDItemLatitude")
    longitude = source_metadata.get("kMDItemLongitude")
    if latitude is not None and longitude is not None:
        altitude = float(source_metadata.get("kMDItemAltitude") or 0)
        location = f"{float(latitude):+09.5f}{float(longitude):+010.5f}{altitude:+07.2f}/"
        metadata["com.apple.quicktime.location.ISO6709"] = location
        metadata["location"] = location

    summary = {
        key.removeprefix("kMDItem"): (
            _iso_datetime(value) if isinstance(value, datetime) else value
        )
        for key, value in source_metadata.items()
    }
    if summary:
        metadata["source_metadata"] = json.dumps(summary, ensure_ascii=False, separators=(",", ":"))
    return metadata


class ExportError(RuntimeError):
    """Expected export failure that can be shown to the browser."""


LIVE_PHOTO_HELPER_LOCK = threading.Lock()


def ensure_live_photo_helper() -> Path:
    helper = SOURCE_TEMP_ROOT / "live-photo-pair"
    if helper.exists():
        return helper
    source = ROOT / "tools" / "live-photo-pair.swift"
    xcrun = shutil.which("xcrun")
    if sys.platform != "darwin" or not xcrun:
        raise ExportError("Live Photo 导出需要 macOS 与 Apple Swift 工具链。")
    with LIVE_PHOTO_HELPER_LOCK:
        if helper.exists():
            return helper
        try:
            result = subprocess.run(
                [xcrun, "swiftc", str(source), "-o", str(helper)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=180,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise ExportError(f"Live Photo 配对工具编译失败：{error}") from error
        if result.returncode != 0 or not helper.exists():
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise ExportError(f"Live Photo 配对工具编译失败：{detail}")
    return helper


class ExportSession:
    def __init__(
        self,
        width: int,
        height: int,
        fps: int,
        frame_count: int,
        source: SourceMedia | None = None,
        source_name: str | None = None,
        export_format: str = "mp4",
    ) -> None:
        self.session_id = uuid.uuid4().hex
        self.width = width
        self.height = height
        self.fps = fps
        self.frame_count = frame_count
        self.received_frames = 0
        self.lock = threading.Lock()
        self.stderr_tail: deque[str] = deque(maxlen=24)

        OUTPUTS.mkdir(parents=True, exist_ok=True)
        self.source = source
        self.source_name = source.original_name if source else clean_source_name(source_name)
        self.export_format = export_format
        self.asset_identifier = str(uuid.uuid4()).upper() if export_format == "livephoto" else None
        self.output_path = unique_output_path(build_output_file_name(self.source_name, export_format))
        self.file_name = self.output_path.name
        self.partial_path = OUTPUTS / f".{self.session_id}.partial.mp4"
        self.cover_path = SOURCE_TEMP_ROOT / f"{self.session_id}-cover.jpg"
        self.partial_archive_path = OUTPUTS / f".{self.session_id}.partial.zip"
        self.pair_directory = SOURCE_TEMP_ROOT / f"{self.session_id}-livephoto"
        metadata = build_output_metadata(source, self.source_name)

        command = build_ffmpeg_command(
            width=width,
            height=height,
            fps=fps,
            output_path=self.partial_path,
            metadata=metadata,
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
            if self.export_format == "livephoto" and self.received_frames == self.frame_count:
                self.cover_path.write_bytes(frame)

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

        try:
            if self.export_format == "livephoto":
                return self._finish_live_photo()
            os.replace(self.partial_path, self.output_path)
            return self.output_path
        finally:
            self._cleanup_source()

    def _finish_live_photo(self) -> Path:
        if not self.cover_path.exists() or not self.asset_identifier:
            raise ExportError("Live Photo 封面帧缺失。")
        helper = ensure_live_photo_helper()
        self.pair_directory.mkdir(parents=True, exist_ok=True)
        base_name = Path(self.source_name).stem.strip(" .")[:120] or "Live-Photo"
        paired_video = self.pair_directory / f"{base_name}.MOV"
        paired_photo = self.pair_directory / f"{base_name}.HEIC"
        source_path = str(self.source.path) if self.source is not None else "-"
        try:
            result = subprocess.run(
                [
                    str(helper),
                    str(self.partial_path),
                    str(self.cover_path),
                    source_path,
                    str(paired_video),
                    str(paired_photo),
                    self.asset_identifier,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=1800,
                check=False,
            )
            if result.returncode != 0 or not paired_video.exists() or not paired_photo.exists():
                detail = result.stderr.decode("utf-8", errors="replace").strip()
                raise ExportError(f"Live Photo 配对失败：{detail or '未生成配对资源。'}")
            with zipfile.ZipFile(self.partial_archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
                archive.write(paired_photo, paired_photo.name)
                archive.write(paired_video, paired_video.name)
            os.replace(self.partial_archive_path, self.output_path)
            return self.output_path
        finally:
            self.partial_path.unlink(missing_ok=True)
            self.cover_path.unlink(missing_ok=True)
            self.partial_archive_path.unlink(missing_ok=True)
            shutil.rmtree(self.pair_directory, ignore_errors=True)

    def _cleanup_source(self) -> None:
        if self.source is not None:
            self.source.path.unlink(missing_ok=True)
            self.source = None

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
        self.cover_path.unlink(missing_ok=True)
        self.partial_archive_path.unlink(missing_ok=True)
        shutil.rmtree(self.pair_directory, ignore_errors=True)
        self._cleanup_source()


def build_ffmpeg_command(
    width: int,
    height: int,
    fps: int,
    output_path: Path,
    metadata: dict[str, str] | None = None,
) -> list[str]:
    command = [
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
    ]
    command.extend([
        "-an",
        "-vf",
        f"scale={width}:{height}:flags=lanczos,setsar=1,format=yuv420p",
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-crf",
        "20",
        "-tag:v",
        "hvc1",
        "-movflags",
        "+faststart+use_metadata_tags",
        "-x265-params",
        "log-level=error",
        "-f",
        "mp4",
    ])
    for key, value in (metadata or {}).items():
        command.extend(["-metadata", f"{key}={value}"])
    command.append(str(output_path))
    return command


class SessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, ExportSession] = {}
        self.lock = threading.Lock()

    def create(
        self,
        width: int,
        height: int,
        fps: int,
        frame_count: int,
        source: SourceMedia | None = None,
        source_name: str | None = None,
        export_format: str = "mp4",
    ) -> ExportSession:
        with self.lock:
            if self.sessions:
                raise ExportError("已有视频正在导出，请等待当前任务完成。")
            session = ExportSession(
                width,
                height,
                fps,
                frame_count,
                source,
                source_name,
                export_format,
            )
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


class SourceManager:
    def __init__(self) -> None:
        self.sources: dict[str, SourceMedia] = {}
        self.lock = threading.Lock()

    def add(self, source: SourceMedia) -> None:
        with self.lock:
            self.sources[source.token] = source

    def take(self, token: str) -> SourceMedia:
        with self.lock:
            source = self.sources.pop(token, None)
        if source is None:
            raise ExportError("原素材元数据已失效，请重新选择文件后导出。")
        return source

    def cancel_all(self) -> None:
        with self.lock:
            sources = list(self.sources.values())
            self.sources.clear()
        for source in sources:
            source.path.unlink(missing_ok=True)


class LivePhotoImportManager:
    def __init__(self) -> None:
        self.exports: dict[str, Path] = {}
        self.lock = threading.Lock()

    def add(self, archive_path: Path) -> str:
        token = uuid.uuid4().hex
        with self.lock:
            self.exports[token] = archive_path
        return token

    def get(self, token: str) -> Path:
        with self.lock:
            archive_path = self.exports.get(token)
        if archive_path is None or not archive_path.is_file():
            raise ExportError("Live Photo 配对包已失效，请重新导出。")
        return archive_path

    def remove(self, token: str) -> None:
        with self.lock:
            self.exports.pop(token, None)


SESSIONS = SessionManager()
SOURCES = SourceManager()
LIVE_PHOTO_IMPORTS = LivePhotoImportManager()
SESSION_ROUTE = re.compile(r"^/api/video/([0-9a-f]{32})/(frame|finish|cancel)$")
SOURCE_ROUTE = re.compile(r"^/api/source/([0-9a-f]{32})/cancel$")
LIVE_PHOTO_IMPORT_ROUTE = re.compile(r"^/api/livephoto/([0-9a-f]{32})/import$")


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
                {"ok": True, "encoder": "libx265", "format": "H.265 MP4 / Apple Live Photo"},
            )
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        try:
            if self.path == "/api/source":
                self.handle_source_upload()
                return
            if self.path == "/api/video/start":
                self.handle_start()
                return

            import_match = LIVE_PHOTO_IMPORT_ROUTE.fullmatch(self.path)
            if import_match is not None:
                self.handle_live_photo_import(import_match.group(1))
                return

            source_match = SOURCE_ROUTE.fullmatch(self.path)
            if source_match is not None:
                self.handle_source_cancel(source_match.group(1))
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
        source_token = str(payload.get("sourceToken") or "")
        source_name = clean_source_name(payload.get("sourceName"))
        export_format = str(payload.get("exportFormat") or "mp4")
        if export_format not in {"mp4", "livephoto"}:
            raise ExportError("导出格式不受支持。")
        if width < 2 or height < 2 or width % 2 or height % 2:
            raise ExportError("视频宽高必须是大于 1 的偶数。")
        if width * height > MAX_PIXELS:
            raise ExportError("视频像素尺寸超过本地服务的安全上限。")
        if fps < 1 or fps > 60:
            raise ExportError("帧率必须在 1 到 60 之间。")
        if frame_count < 1 or frame_count > 18_000:
            raise ExportError("视频帧数超出安全范围。")

        source = SOURCES.take(source_token) if source_token else None
        try:
            session = SESSIONS.create(
                width,
                height,
                fps,
                frame_count,
                source=source,
                source_name=source_name,
                export_format=export_format,
            )
        except Exception:
            if source is not None:
                source.path.unlink(missing_ok=True)
            raise
        self.send_json(
            HTTPStatus.CREATED,
            {
                "sessionId": session.session_id,
                "width": width,
                "height": height,
                "fps": fps,
                "frameCount": frame_count,
                "fileName": session.file_name,
                "exportFormat": session.export_format,
            },
        )

    def handle_source_upload(self) -> None:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
        if content_type != "application/octet-stream":
            raise ExportError("原素材必须以二进制文件上传。")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_SOURCE_BYTES:
            raise ExportError("原素材大小不正确或超过 20 GiB 上限。")
        original_name = clean_source_name(unquote(self.headers.get("X-Source-Name", "")))
        last_modified_text = self.headers.get("X-Source-Last-Modified", "")
        try:
            last_modified_ms = int(last_modified_text) if last_modified_text else None
        except ValueError:
            last_modified_ms = None
        token = uuid.uuid4().hex
        suffix = Path(original_name).suffix[:16]
        source_path = SOURCE_TEMP_ROOT / f"{token}{suffix}"
        remaining = length
        try:
            with source_path.open("wb") as source_file:
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ExportError("原素材上传不完整。")
                    source_file.write(chunk)
                    remaining -= len(chunk)
            if last_modified_ms:
                timestamp = last_modified_ms / 1000
                os.utime(source_path, (timestamp, timestamp))
        except Exception:
            source_path.unlink(missing_ok=True)
            raise
        source = SourceMedia(token, source_path, original_name, last_modified_ms)
        SOURCES.add(source)
        self.send_json(
            HTTPStatus.CREATED,
            {
                "sourceToken": token,
                "sourceName": original_name,
                "sourceBytes": length,
            },
        )

    def handle_source_cancel(self, source_token: str) -> None:
        try:
            source = SOURCES.take(source_token)
        except ExportError:
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        source.path.unlink(missing_ok=True)
        self.send_json(HTTPStatus.OK, {"ok": True})

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
        import_token = (
            LIVE_PHOTO_IMPORTS.add(output_path)
            if session.export_format == "livephoto"
            else None
        )
        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "width": session.width,
                "height": session.height,
                "fileName": session.file_name,
                "outputPath": relative_path,
                "downloadUrl": f"/{relative_path}",
                "exportFormat": session.export_format,
                "assetIdentifier": session.asset_identifier,
                "importUrl": (
                    f"/api/livephoto/{import_token}/import"
                    if import_token is not None
                    else None
                ),
            },
        )

    def handle_live_photo_import(self, import_token: str) -> None:
        archive_path = LIVE_PHOTO_IMPORTS.get(import_token)
        directory_name = f"{archive_path.stem}-iphone"
        import_directory = OUTPUTS / directory_name
        for index in range(2, 10_000):
            if not import_directory.exists():
                break
            import_directory = OUTPUTS / f"{directory_name}-{index}"
        else:
            raise ExportError("无法为 iPhone Live Photo 配对文件分配目录。")
        import_directory.mkdir(parents=True, exist_ok=False)
        try:
            with zipfile.ZipFile(archive_path) as archive:
                photo_entries = [entry for entry in archive.infolist() if Path(entry.filename).suffix.lower() in {".jpg", ".jpeg", ".heic"}]
                video_entries = [entry for entry in archive.infolist() if Path(entry.filename).suffix.lower() == ".mov"]
                if len(photo_entries) != 1 or len(video_entries) != 1:
                    raise ExportError("Live Photo 配对包中的 HEIC/MOV 资源不完整。")
                photo_path = import_directory / clean_source_name(Path(photo_entries[0].filename).name)
                video_path = import_directory / clean_source_name(Path(video_entries[0].filename).name)
                with archive.open(photo_entries[0]) as source_file, photo_path.open("wb") as target_file:
                    shutil.copyfileobj(source_file, target_file)
                with archive.open(video_entries[0]) as source_file, video_path.open("wb") as target_file:
                    shutil.copyfileobj(source_file, target_file)

            open_tool = shutil.which("open")
            if sys.platform != "darwin" or not open_tool:
                raise ExportError("只能在 macOS 上把 Live Photo 配对文件交给“照片”。")
            result = subprocess.run(
                [open_tool, "-a", "Photos", str(photo_path), str(video_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=30,
                check=False,
            )
            if result.returncode != 0:
                detail = result.stderr.decode("utf-8", errors="replace").strip()
                raise ExportError(f"无法打开 Mac“照片”：{detail or '未知错误。'}")
            LIVE_PHOTO_IMPORTS.remove(import_token)
            relative_directory = import_directory.relative_to(ROOT).as_posix()
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "message": "已把 HEIC 与 MOV 一起交给 Mac“照片”，请在“照片”中完成导入。",
                    "pairDirectory": relative_directory,
                },
            )
        except Exception:
            shutil.rmtree(import_directory, ignore_errors=True)
            raise

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
    atexit.register(SOURCES.cancel_all)
    print(f"本地项目：http://{args.host}:{args.port}/index.html", flush=True)
    print(f"H.265 编码器：{FFMPEG_EXE}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        SESSIONS.cancel_all()
        SOURCES.cancel_all()
        shutil.rmtree(SOURCE_TEMP_ROOT, ignore_errors=True)
        server.server_close()


if __name__ == "__main__":
    main()

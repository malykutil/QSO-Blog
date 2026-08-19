import ctypes
import os
from pathlib import Path
from types import TracebackType


class AlreadyRunningError(RuntimeError):
    pass


class SingleInstanceLock:
    """Cross-platform process lock; a named mutex is used by the Windows EXE."""

    def __init__(self, name: str, lock_path: Path) -> None:
        self.name = name
        self.lock_path = lock_path
        self._handle: int | None = None
        self._file = None

    def __enter__(self) -> "SingleInstanceLock":
        if os.name == "nt":
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            create_mutex = kernel32.CreateMutexW
            create_mutex.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
            create_mutex.restype = ctypes.c_void_p
            handle = create_mutex(None, True, f"Local\\{self.name}")
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
                kernel32.CloseHandle(handle)
                raise AlreadyRunningError("scheduler instance already exists")
            self._handle = int(handle)
            return self

        import fcntl

        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self._file = self.lock_path.open("a+b")
        try:
            fcntl.flock(self._file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self._file.close()
            self._file = None
            raise AlreadyRunningError("scheduler instance already exists") from exc
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if os.name == "nt" and self._handle is not None:
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.ReleaseMutex(ctypes.c_void_p(self._handle))
            kernel32.CloseHandle(ctypes.c_void_p(self._handle))
            self._handle = None
        elif self._file is not None:
            import fcntl

            fcntl.flock(self._file.fileno(), fcntl.LOCK_UN)
            self._file.close()
            self._file = None

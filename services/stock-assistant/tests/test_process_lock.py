import uuid

import pytest

from stock_assistant.process_lock import AlreadyRunningError, SingleInstanceLock


def test_second_scheduler_instance_is_rejected(tmp_path):
    lock_name = f"AIStockPaperAssistantTest-{uuid.uuid4()}"
    lock_path = tmp_path / "scheduler.lock"
    with SingleInstanceLock(lock_name, lock_path):
        with pytest.raises(AlreadyRunningError):
            with SingleInstanceLock(lock_name, lock_path):
                pass

    with SingleInstanceLock(lock_name, lock_path):
        pass

"""Symmetric encryption for secrets we must store and read back (e.g. third-party API tokens)."""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class DecryptionError(Exception):
    pass


@lru_cache
def _fernet() -> Fernet:
    if not settings.ENCRYPTION_KEY:
        raise RuntimeError("ENCRYPTION_KEY is not set")
    return Fernet(settings.ENCRYPTION_KEY.encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise DecryptionError("could not decrypt value") from exc

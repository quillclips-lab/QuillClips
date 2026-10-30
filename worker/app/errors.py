"""Errors that carry a Turkish, user-facing message."""


class QCError(Exception):
    """A pipeline failure with a readable message for the UI."""

    def __init__(self, message: str, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail


class ClaudeLimitError(QCError):
    """Claude subscription usage/rate limit reached. Jobs pause instead of failing."""


class ClaudeAuthError(QCError):
    pass


class CancelledError(QCError):
    pass

"""Timestamped service logs on stderr, leaving MCP stdout for its protocol."""

import logging
import os
import sys


def get_logger(component: str) -> logging.Logger:
    logger = logging.getLogger(f"p1.{component}")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S%z"))
        logger.addHandler(handler)
    logger.setLevel(os.getenv("P1_LOG_LEVEL", "INFO").upper())
    logger.propagate = False
    return logger

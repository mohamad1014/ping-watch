import logging

from app.logging import _parse_log_level


def test_parse_log_level_defaults_to_info():
    assert _parse_log_level(None) == logging.INFO
    assert _parse_log_level("") == logging.INFO
    assert _parse_log_level("invalid") == logging.INFO


def test_parse_log_level_accepts_standard_levels():
    assert _parse_log_level("debug") == logging.DEBUG
    assert _parse_log_level("INFO") == logging.INFO
    assert _parse_log_level("warning") == logging.WARNING
    assert _parse_log_level("ERROR") == logging.ERROR

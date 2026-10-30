import pytest
from keys import update


def test_update_is_private_and_does_not_duplicate(tmp_path):
    path = tmp_path / '.env'
    update(path, 'GROQ_API_KEY', 'first')
    update(path, 'GROQ_API_KEY', 'second')
    assert path.read_text() == 'GROQ_API_KEY=second\n'
    assert path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(ValueError): update(path, 'UNLISTED_KEY', 'value')
    with pytest.raises(ValueError): update(path, 'GROQ_API_KEY', 'bad\nline')

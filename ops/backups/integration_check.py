"""Container-only smoke test using synthetic files and a temporary local repository."""
import os
from pathlib import Path
import tempfile
from unittest.mock import patch
import run

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    source = root / 'source'
    source.mkdir()
    (source / 'example.txt').write_text('Synthetic backup verification only', encoding='utf-8')
    settings = {name: 'test-only-not-a-real-secret-' * 2 for name in run.REQUIRED}
    settings.update(PATH=os.environ['PATH'], HOME=os.environ['HOME'])
    real_command = run.command
    def local_command(args, env, cwd=None):
        args = [str(source) if arg == 'source:familytrack' else arg for arg in args]
        return real_command(args, env, cwd)
    with patch.object(run, 'REPOSITORY', str(root / 'repository')), patch.object(run, 'command', local_command):
        run.run(dict(settings, BACKUP_MODE='init'))
        result = run.run(settings)
        assert result['files'] == 1 and result['restoreVerified']
        print('PASS: encrypted snapshot, actual restore and byte comparison using synthetic data')

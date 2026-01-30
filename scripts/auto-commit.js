const { execSync } = require('child_process');

function runCommand(command) {
  try {
    console.log(`Running: ${command}`);
    return execSync(command, { encoding: 'utf8', stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    return null;
  }
}

function autoCommit() {
  // 检查是否有更改
  const status = execSync('git status --porcelain', { encoding: 'utf8' });
  if (!status) {
    console.log('No changes to commit.');
    return;
  }

  // 获取提交信息，如果没有提供则使用默认信息
  const commitMessage = process.argv[2] || `Auto-commit: ${new Date().toISOString()}`;

  console.log('Changes detected. Starting auto-commit process...');

  // 1. Git add
  runCommand('git add .');

  // 2. Git commit
  runCommand(`git commit -m "${commitMessage}"`);

  // 3. Git push to main
  runCommand('git push origin main');

  console.log('Auto-commit completed successfully!');
}

autoCommit();

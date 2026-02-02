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

  // 解析变更文件以生成更具体的提交信息
  const lines = status.trim().split('\n');
  const changes = lines.map(line => {
    const mode = line.substring(0, 2).trim();
    const file = line.substring(3).trim();
    const fileName = file.split(/[/\\]/).pop();
    
    if (mode === 'M') return `update ${fileName}`;
    if (mode === 'A' || mode === '??') return `add ${fileName}`;
    if (mode === 'D') return `delete ${fileName}`;
    if (mode === 'R') return `rename ${fileName}`;
    return `change ${fileName}`;
  });

  // 去重并限制显示数量
  const uniqueChanges = [...new Set(changes)];
  const displayChanges = uniqueChanges.slice(0, 3).join(', ');
  const suffix = uniqueChanges.length > 3 ? ` and ${uniqueChanges.length - 3} more...` : '';
  const changeSummary = displayChanges ? `: ${displayChanges}${suffix}` : '';

  // 获取时间信息
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const formattedTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  
  // 组合最终提交信息
  const defaultMessage = `Auto-commit${changeSummary} (${formattedTime})`;
  const commitMessage = process.argv[2] || defaultMessage;

  console.log('Changes detected. Starting auto-commit process...');
  console.log(`Commit message: ${commitMessage}`);

  // 1. Git add
  runCommand('git add .');

  // 2. Git commit
  runCommand(`git commit -m "${commitMessage}"`);

  // 3. Git push to main
  runCommand('git push origin main');

  console.log('Auto-commit completed successfully!');
}

autoCommit();

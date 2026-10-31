// Prints the ADMIN_PASSWORD_HASH line for the admin page's login, so the password itself is never stored.
// Usage:  npm run admin-password        (asks for the password without showing it)
const readline = require('readline');
const { hashPassword, passwordProblem } = require('./passwords');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = (s) => { if (!rl.muted) rl.output.write(s); };

function ask(question) {
  return new Promise((resolve) => {
    rl.muted = false;
    rl.question(question, (answer) => { rl.output.write('\n'); resolve(answer); });
    rl.muted = true;
  });
}

(async () => {
  const password = await ask('New admin password: ');
  const again = await ask('Repeat it: ');
  rl.close();
  if (password !== again) return console.error('The two passwords do not match.'), process.exit(1);
  const problem = passwordProblem(password);
  if (problem || password.length < 12) return console.error(problem || 'Use at least 12 characters for the admin password.'), process.exit(1);
  console.log(`\nADMIN_PASSWORD_HASH=${hashPassword(password)}`);
})();

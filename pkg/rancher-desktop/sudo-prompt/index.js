const Node = {
  child:    require('child_process'),
  crypto:   require('crypto'),
  electron: require('electron'),
  fs:       require('fs'),
  os:       require('os'),
  path:     require('path'),
  process,
  util:     require('util'),
};

function Attempt(instance, end) {
  const platform = Node.process.platform;

  if (platform === 'darwin') {
    return Mac(instance, end);
  }
  if (platform === 'linux') {
    return Linux(instance, end);
  }
  if (platform === 'win32') {
    return Windows(instance, end);
  }
  end(new Error('Platform not yet supported.'));
}

function EscapeDoubleQuotes(string) {
  if (typeof string !== 'string') {
    throw new TypeError('Expected a string.');
  }

  return string.replace(/"/g, '\\"');
}

function Exec() {
  if (arguments.length < 1 || arguments.length > 3) {
    throw new Error('Wrong number of arguments.');
  }
  const command = arguments[0];
  let options = {};
  let end = function() {};

  if (typeof command !== 'string') {
    throw new TypeError('Command should be a string.');
  }
  if (arguments.length === 2) {
    if (arguments[1] !== null && typeof arguments[1] === 'object') {
      options = arguments[1];
    } else if (typeof arguments[1] === 'function') {
      end = arguments[1];
    } else {
      throw new TypeError('Expected options or callback.');
    }
  } else if (arguments.length === 3) {
    if (arguments[1] !== null && typeof arguments[1] === 'object') {
      options = arguments[1];
    } else {
      throw new TypeError('Expected options to be an object.');
    }
    if (typeof arguments[2] === 'function') {
      end = arguments[2];
    } else {
      throw new TypeError('Expected callback to be a function.');
    }
  }
  if (/^sudo/i.test(command)) {
    return end(new Error('Command should not be prefixed with "sudo".'));
  }
  if (typeof options.name === 'undefined') {
    const title = Node.process.title;

    if (ValidName(title)) {
      options.name = title;
    } else {
      return end(new Error('process.title cannot be used as a valid name.'));
    }
  } else if (!ValidName(options.name)) {
    let error = '';

    error += 'options.name must be alphanumeric only ';
    error += '(spaces are allowed) and <= 70 characters.';

    return end(new Error(error));
  }
  if (typeof options.icns !== 'undefined') {
    if (typeof options.icns !== 'string') {
      return end(new Error('options.icns must be a string if provided.'));
    } else if (options.icns.trim().length === 0) {
      return end(new Error('options.icns must not be empty if provided.'));
    }
  }
  if (typeof options.env !== 'undefined') {
    if (typeof options.env !== 'object') {
      return end(new Error('options.env must be an object if provided.'));
    } else if (Object.keys(options.env).length === 0) {
      return end(new Error('options.env must not be empty if provided.'));
    } else {
      for (const key in options.env) {
        const value = options.env[key];

        if (typeof key !== 'string' || typeof value !== 'string') {
          return end(
            new Error('options.env environment variables must be strings.'),
          );
        }
        // "Environment variable names used by the utilities in the Shell and
        // Utilities volume of IEEE Std 1003.1-2001 consist solely of uppercase
        // letters, digits, and the '_' (underscore) from the characters defined
        // in Portable Character Set and do not begin with a digit. Other
        // characters may be permitted by an implementation; applications shall
        // tolerate the presence of such names."
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          return end(
            new Error(
              `options.env has an invalid environment variable name: ${
                JSON.stringify(key) }`,
            ),
          );
        }
        if (/[\r\n]/.test(value)) {
          return end(
            new Error(
              `options.env has an invalid environment variable value: ${
                JSON.stringify(value) }`,
            ),
          );
        }
      }
    }
  }
  const platform = Node.process.platform;

  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    return end(new Error('Platform not yet supported.'));
  }
  const instance = {
    command,
    options,
    uuid: undefined,
    path: undefined,
  };

  Attempt(instance, end);
}

function Linux(instance, end) {
  LinuxBinary(instance,
    (error, binary) => {
      if (error) {
        return end(error);
      }
      let command = [];

      // Preserve current working directory:
      command.push(`cd "${ EscapeDoubleQuotes(Node.process.cwd()) }";`);
      // Export environment variables:
      for (const key in instance.options.env) {
        const value = instance.options.env[key];

        command.push(`export ${ key }="${ EscapeDoubleQuotes(value) }";`);
      }
      command.push(`"${ EscapeDoubleQuotes(binary) }"`);
      if (/kdesudo/i.test(binary)) {
        command.push(
          '--comment',
          `"${ instance.options.name } wants to make changes. ` +
          `Enter your password to allow this."`,
        );
        command.push('-d'); // Do not show the command to be run in the dialog.
        command.push('--');
      } else if (/pkexec/i.test(binary)) {
        command.push('--disable-internal-agent');
      }
      const magic = 'SUDOPROMPT\n';

      command.push(
        `/bin/bash -c "echo ${ EscapeDoubleQuotes(magic.trim()) }; ${
          EscapeDoubleQuotes(instance.command)
        }"`,
      );
      command = command.join(' ');
      Node.child.exec(command, { encoding: 'utf-8', maxBuffer: MAX_BUFFER },
        (error, stdout, stderr) => {
          // ISSUE 88:
          // We must distinguish between elevation errors and command errors.
          //
          // KDESUDO:
          // kdesudo provides no way to do this. We add a magic marker to know
          // if elevation succeeded. Any error thereafter is a command error.
          //
          // PKEXEC:
          // "Upon successful completion, the return value is the return value of
          // PROGRAM. If the calling process is not authorized or an
          // authorization could not be obtained through authentication or an
          // error occured, pkexec exits with a return value of 127. If the
          // authorization could not be obtained because the user dismissed the
          // authentication dialog, pkexec exits with a return value of 126."
          //
          // However, we do not rely on pkexec's return of 127 since our magic
          // marker is more reliable, and we already use it for kdesudo.
          const elevated = stdout && stdout.slice(0, magic.length) === magic;

          if (elevated) {
            stdout = stdout.slice(magic.length);
          }
          // Only normalize the error if it is definitely not a command error:
          // In other words, if we know that the command was never elevated.
          // We do not inspect error messages beyond NO_POLKIT_AGENT.
          // We cannot rely on English errors because of internationalization.
          if (error && !elevated) {
            if (/No authentication agent found/.test(stderr)) {
              error.message = NO_POLKIT_AGENT;
            } else {
              error.message = PERMISSION_DENIED;
            }
          }
          end(error, stdout, stderr);
        },
      );
    },
  );
}

function LinuxBinary(_, end) {
  let index = 0;
  // We used to prefer gksudo over pkexec since it enabled a better prompt.
  // However, gksudo cannot run multiple commands concurrently.
  const paths = ['/usr/bin/kdesudo', '/usr/bin/pkexec'];

  function test() {
    if (index === paths.length) {
      return end(new Error('Unable to find pkexec or kdesudo.'));
    }
    const path = paths[index++];

    Node.fs.stat(path,
      (error) => {
        if (error) {
          if (error.code === 'ENOTDIR') {
            return test();
          }
          if (error.code === 'ENOENT') {
            return test();
          }
          end(error);
        } else {
          end(undefined, path);
        }
      },
    );
  }
  test();
}

function Mac(instance, callback) {
  const temp = Node.os.tmpdir();

  if (!temp) {
    return callback(new Error('os.tmpdir() not defined.'));
  }
  const user = Node.process.env.USER; // Applet shell scripts require $USER.

  if (!user) {
    return callback(new Error('env[\'USER\'] not defined.'));
  }
  UUID(instance,
    (error, uuid) => {
      if (error) {
        return callback(error);
      }
      instance.uuid = uuid;
      instance.path = Node.path.join(
        temp,
        instance.uuid,
      );
      Node.fs.mkdir(instance.path, 0o700,
        (error) => {
          if (error) {
            return callback(error);
          }
          function end(error, stdout, stderr) {
            Remove(instance.path,
              (errorRemove) => {
                if (error) {
                  return callback(error);
                }
                if (errorRemove) {
                  return callback(errorRemove);
                }
                callback(undefined, stdout, stderr);
              },
            );
          }
          MacCommand(instance,
            (error) => {
              if (error) {
                return end(error);
              }
              MacOpen(instance,
                (error, stdout, stderr) => {
                  if (error) {
                    return end(error, stdout, stderr);
                  }
                  MacResult(instance, end);
                },
              );
            },
          );
        },
      );
    },
  );
}

function MacCommand(instance, end) {
  const path = Node.path.join(instance.path, 'sudo-prompt-command');
  let script = [];

  // Preserve current working directory:
  // We do this for commands that rely on relative paths.
  // This runs in a subshell and will not change the cwd of sudo-prompt-script.
  script.push(`cd "${ EscapeDoubleQuotes(Node.process.cwd()) }"`);
  // Export environment variables:
  for (const key in instance.options.env) {
    const value = instance.options.env[key];

    script.push(`export ${ key }="${ EscapeDoubleQuotes(value) }"`);
  }
  script.push(instance.command);
  script = script.join('\n');
  Node.fs.writeFile(path, script, 'utf-8', end);
}

function MacOpen(instance, end) {
  let basePath;

  if (Node.electron.app?.isPackaged) {
    basePath = process.resourcesPath;
  } else {
    basePath = process.cwd();
  }

  // We must set the cwd so that the AppleScript can find the sudo-prompt-command script.
  const options = {
    cwd:      instance.path,
    encoding: 'utf-8',
  };

  if (Node.process.env.RD_SUDO_PROMPT_OSASCRIPT) {
    const script = Node.path.join(basePath, 'resources', 'darwin', 'internal', 'Rancher Desktop.app', 'Contents', 'Resources', 'Scripts', 'main.scpt');

    Node.child.exec(`/usr/bin/osascript "${ EscapeDoubleQuotes(Node.path.normalize(script)) }"`, options, end);
  } else {
    // We must run the binary directly so that the cwd will apply.
    const binary = Node.path.join(basePath, 'resources', 'darwin', 'internal', 'Rancher Desktop.app', 'Contents', 'MacOS', 'applet');

    Node.child.exec(`"${ EscapeDoubleQuotes(Node.path.normalize(binary)) }"`, options, end);
  }
}

function MacResult(instance, end) {
  Node.fs.readFile(Node.path.join(instance.path, 'code'), 'utf-8',
    (error, code) => {
      if (error) {
        if (error.code === 'ENOENT') {
          return end(new Error(PERMISSION_DENIED));
        }
        end(error);
      } else {
        Node.fs.readFile(Node.path.join(instance.path, 'stdout'), 'utf-8',
          (error, stdout) => {
            if (error) {
              return end(error);
            }
            Node.fs.readFile(Node.path.join(instance.path, 'stderr'), 'utf-8',
              (error, stderr) => {
                if (error) {
                  return end(error);
                }
                code = parseInt(code.trim(), 10); // Includes trailing newline.
                if (code === 0) {
                  end(undefined, stdout, stderr);
                } else {
                  error = new Error(
                    `Command failed: ${ instance.command }\n${ stderr }`,
                  );
                  error.code = String(code);
                  end(error, stdout, stderr);
                }
              },
            );
          },
        );
      }
    },
  );
}

function Remove(path, end) {
  if (typeof path !== 'string' || !path.trim()) {
    return end(new Error('Argument path not defined.'));
  }
  let command = [];

  if (Node.process.platform === 'win32') {
    if (/"/.test(path)) {
      return end(new Error('Argument path cannot contain double-quotes.'));
    }
    command.push(`rmdir /s /q "${ path }"`);
  } else {
    command.push('/bin/rm');
    command.push('-rf');
    command.push(`"${ EscapeDoubleQuotes(Node.path.normalize(path)) }"`);
  }
  command = command.join(' ');
  Node.child.exec(command, { encoding: 'utf-8' }, end);
}

function UUID(instance, end) {
  Node.crypto.randomBytes(256,
    (error, random) => {
      if (error) {
        random = `${ Date.now() }${ Math.random() }`;
      }
      const hash = Node.crypto.createHash('SHA256');

      hash.update('sudo-prompt-3');
      hash.update(instance.options.name);
      hash.update(instance.command);
      hash.update(random);
      const uuid = hash.digest('hex').slice(-32);

      if (!uuid || typeof uuid !== 'string' || uuid.length !== 32) {
        // This is critical to ensure we don't remove the wrong temp directory.
        return end(new Error('Expected a valid UUID.'));
      }
      end(undefined, uuid);
    },
  );
}

function ValidName(string) {
  // We use 70 characters as a limit to side-step any issues with Unicode
  // normalization form causing a 255 character string to exceed the fs limit.
  if (!/^[a-z0-9 ]+$/i.test(string)) {
    return false;
  }
  if (string.trim().length === 0) {
    return false;
  }

  return string.length <= 70;
}

function Windows(instance, callback) {
  const temp = Node.os.tmpdir();

  if (!temp) {
    return callback(new Error('os.tmpdir() not defined.'));
  }
  UUID(instance,
    (error, uuid) => {
      if (error) {
        return callback(error);
      }
      instance.uuid = uuid;
      instance.path = Node.path.join(temp, instance.uuid);
      if (/"/.test(instance.path)) {
        // We expect double quotes to be reserved on Windows.
        // Even so, we test for this and abort if they are present.
        return callback(
          new Error('instance.path cannot contain double-quotes.'),
        );
      }
      instance.pathElevate = Node.path.join(instance.path, 'elevate.vbs');
      instance.pathExecute = Node.path.join(instance.path, 'execute.bat');
      instance.pathCommand = Node.path.join(instance.path, 'command.bat');
      instance.pathStdout = Node.path.join(instance.path, 'stdout');
      instance.pathStderr = Node.path.join(instance.path, 'stderr');
      instance.pathStatus = Node.path.join(instance.path, 'status');
      Node.fs.mkdir(instance.path,
        (error) => {
          if (error) {
            return callback(error);
          }
          function end(error, stdout, stderr) {
            Remove(instance.path,
              (errorRemove) => {
                if (error) {
                  return callback(error);
                }
                if (errorRemove) {
                  return callback(errorRemove);
                }
                callback(undefined, stdout, stderr);
              },
            );
          }
          WindowsWriteExecuteScript(instance,
            (error) => {
              if (error) {
                return end(error);
              }
              WindowsWriteCommandScript(instance,
                (error) => {
                  if (error) {
                    return end(error);
                  }
                  WindowsElevate(instance,
                    (error, stdout, stderr) => {
                      if (error) {
                        return end(error, stdout, stderr);
                      }
                      WindowsWaitForStatus(instance,
                        (error) => {
                          if (error) {
                            return end(error);
                          }
                          WindowsResult(instance, end);
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
}

function WindowsElevate(instance, end) {
  // We used to use this for executing elevate.vbs:
  // var command = 'cscript.exe //NoLogo "' + instance.pathElevate + '"';
  let command = [];

  command.push('powershell.exe');
  command.push('Start-Process');
  command.push('-FilePath');
  // Escape characters for cmd using double quotes:
  // Escape characters for PowerShell using single quotes:
  // Escape single quotes for PowerShell using backtick:
  // See: https://ss64.com/ps/syntax-esc.html
  command.push(`"'${ instance.pathExecute.replace(/'/g, "`'") }'"`);
  command.push('-WindowStyle hidden');
  command.push('-Verb runAs');
  command = command.join(' ');
  const child = Node.child.exec(command, { encoding: 'utf-8' },
    (error, stdout, stderr) => {
      // We used to return PERMISSION_DENIED only for error messages containing
      // the string 'canceled by the user'. However, Windows internationalizes
      // error messages (issue 96) so now we must assume all errors here are
      // permission errors. This seems reasonable, given that we already run the
      // user's command in a subshell.
      if (error) {
        return end(new Error(PERMISSION_DENIED), stdout, stderr);
      }
      end();
    },
  );

  child.stdin.end(); // Otherwise PowerShell waits indefinitely on Windows 7.
}

function WindowsResult(instance, end) {
  Node.fs.readFile(instance.pathStatus, 'utf-8',
    (error, code) => {
      if (error) {
        return end(error);
      }
      Node.fs.readFile(instance.pathStdout, 'utf-8',
        (error, stdout) => {
          if (error) {
            return end(error);
          }
          Node.fs.readFile(instance.pathStderr, 'utf-8',
            (error, stderr) => {
              if (error) {
                return end(error);
              }
              code = parseInt(code.trim(), 10);
              if (code === 0) {
                end(undefined, stdout, stderr);
              } else {
                error = new Error(
                  `Command failed: ${ instance.command }\r\n${ stderr }`,
                );
                error.code = String(code);
                end(error, stdout, stderr);
              }
            },
          );
        },
      );
    },
  );
}

function WindowsWaitForStatus(instance, end) {
  // VBScript cannot wait for the elevated process to finish so we have to poll.
  // VBScript cannot return error code if user does not grant permission.
  // PowerShell can be used to elevate and wait on Windows 10.
  // PowerShell can be used to elevate on Windows 7 but it cannot wait.
  // powershell.exe Start-Process cmd.exe -Verb runAs -Wait
  Node.fs.stat(instance.pathStatus,
    (error, stats) => {
      if ((error && error.code === 'ENOENT') || stats.size < 2) {
        // Retry if file does not exist or is not finished writing.
        // We expect a file size of 2. That should cover at least "0\r".
        // We use a 1 second timeout to keep a light footprint for long-lived
        // sudo-prompt processes.
        setTimeout(
          () => {
            // If administrator has no password and user clicks Yes, then
            // PowerShell returns no error and execute (and command) never runs.
            // We check that command output has been redirected to stdout file:
            Node.fs.stat(instance.pathStdout,
              (error) => {
                if (error) {
                  return end(new Error(PERMISSION_DENIED));
                }
                WindowsWaitForStatus(instance, end);
              },
            );
          },
          1000,
        );
      } else if (error) {
        end(error);
      } else {
        end();
      }
    },
  );
}

function WindowsWriteCommandScript(instance, end) {
  const cwd = Node.process.cwd();

  if (/"/.test(cwd)) {
    // We expect double quotes to be reserved on Windows.
    // Even so, we test for this and abort if they are present.
    return end(new Error('process.cwd() cannot contain double-quotes.'));
  }
  let script = [];

  script.push('@echo off');
  // Set code page to UTF-8:
  script.push('chcp 65001>nul');
  // Preserve current working directory:
  // We pass /d as an option in case the cwd is on another drive (issue 70).
  script.push(`cd /d "${ cwd }"`);
  // Export environment variables:
  for (const key in instance.options.env) {
    // "The characters <, >, |, &, ^ are special command shell characters, and
    // they must be preceded by the escape character (^) or enclosed in
    // quotation marks. If you use quotation marks to enclose a string that
    // contains one of the special characters, the quotation marks are set as
    // part of the environment variable value."
    // In other words, Windows assigns everything that follows the equals sign
    // to the value of the variable, whereas Unix systems ignore double quotes.
    const value = instance.options.env[key];

    script.push(`set ${ key }=${ value.replace(/([<>\\|&^])/g, '^$1') }`);
  }
  script.push(instance.command);
  script = script.join('\r\n');
  Node.fs.writeFile(instance.pathCommand, script, 'utf-8', end);
}

function WindowsWriteExecuteScript(instance, end) {
  let script = [];

  script.push('@echo off');
  script.push(
    `call "${ instance.pathCommand }"` +
    ` > "${ instance.pathStdout }" 2> "${ instance.pathStderr }"`,
  );
  script.push(`(echo %ERRORLEVEL%) > "${ instance.pathStatus }"`);
  script = script.join('\r\n');
  Node.fs.writeFile(instance.pathExecute, script, 'utf-8', end);
}

export const exec = Exec;

const PERMISSION_DENIED = 'User did not grant permission.';
const NO_POLKIT_AGENT = 'No polkit authentication agent found.';

// See issue 66:
const MAX_BUFFER = 134217728;

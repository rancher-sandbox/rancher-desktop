import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

type AuthConfig = {
  username?: string,
  password?: string,
  auth?: string,
  email?: string,
  serveraddress?: string,
  identitytoken?: string,
  registrytoken?: string,
}

type PartialDockerConfig = {
  auths?: Record<string, AuthConfig>,
  credsStore?: string,
  credHelpers?: Record<string, string>,
}

function getDefaultDockerCredsStore(): string {
  let platform = os.platform()
  if (platform.startsWith('win')) {
    return 'wincred';
  } else if (platform === 'darwin') {
    return 'osxkeychain';
  } else if (platform === 'linux') {
    return 'secretservice';
  }{
    throw new Error(`platform "${ platform }" is not supported`);
  }
}

async function dockerDesktopCredHelperWorking(passedHelperPath?: string): Promise<boolean> {
  const helperPath = passedHelperPath ?? 'docker-credential-desktop';
  let proc: any;
  try {
    proc = spawn(helperPath, ['list']);
  } catch {
    return false;
  }

  return await new Promise( (resolve) => {
    proc.on('exit', (code: number) => {
      resolve(!code);
    });
  });
}

async function ensureDockerConfig(): Promise<void> {
  const dockerConfigPath = path.join(os.homedir(), '.docker', 'config.json')
  let dockerConfig: PartialDockerConfig = {};
  try {
    dockerConfig = JSON.parse(await fs.promises.readFile(dockerConfigPath, 'utf8'));
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  let configChanged = false;
  if (!dockerConfig.credsStore) {
    dockerConfig.credsStore = getDefaultDockerCredsStore();
    configChanged = true;
  } else if (dockerConfig.credsStore === 'desktop' && !dockerDesktopCredHelperWorking()) {
    dockerConfig.credsStore = getDefaultDockerCredsStore();
    configChanged = true;
  }
  if (configChanged) {
    await fs.promises.writeFile(dockerConfigPath, JSON.stringify(dockerConfig));
  }
}

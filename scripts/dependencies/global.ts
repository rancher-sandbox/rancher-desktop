// Every global dependency whose version and checksums live in
// `dependencies.yaml`.  Imported by `scripts/rddepman.ts`.

import { AlpineLimaISO, Lima, Qemu, SocketVMNet } from '@/scripts/dependencies/lima';
import { MobyOpenAPISpec } from '@/scripts/dependencies/moby-openapi';
import * as tools from '@/scripts/dependencies/tools';
import { Wix } from '@/scripts/dependencies/wix';
import { Moproxy, WSLDistro } from '@/scripts/dependencies/wsl';
import { VersionedDependency } from '@/scripts/lib/dependencies';

export const globalDependencies: VersionedDependency[] = [
  new tools.KuberlrAndKubectl(),
  new tools.Helm(),
  new tools.DockerCLI(),
  new tools.DockerBuildx(),
  new tools.DockerCompose(),
  new tools.DockerProvidedCredHelpers(),
  new tools.GoLangCILint(),
  new tools.CheckSpelling(),
  new tools.Trivy(),
  new tools.Steve(),
  new tools.RancherDashboard(),
  new tools.ECRCredHelper(),
  new Lima(),
  new Qemu(),
  new SocketVMNet(),
  new AlpineLimaISO(),
  new WSLDistro(),
  new Wix(),
  new MobyOpenAPISpec(),
  new Moproxy(),
  new tools.WasmShims(),
  new tools.CertManager(),
  new tools.SpinOperator(),
  new tools.SpinCLI(),
  new tools.SpinKubePlugin(),
];

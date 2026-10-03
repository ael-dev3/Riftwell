import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { Interface, type JsonFragment } from 'ethers';

export type Artifact = {
  source: string;
  abi: JsonFragment[];
  bytecode: string;
  deployedBytecode: string;
};
export type Artifacts = Record<string, Artifact>;
type CompilerOutput = {
  errors?: { severity: string; formattedMessage: string }[];
  contracts?: Record<
    string,
    Record<
      string,
      {
        abi: JsonFragment[];
        evm: {
          bytecode: { object: string };
          deployedBytecode: { object: string };
        };
      }
    >
  >;
};

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
function sourcesIn(
  dir: string,
  sources: Record<string, { content: string }> = {},
) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) sourcesIn(absolute, sources);
    else if (entry.name.endsWith('.sol'))
      sources[path.relative(root, absolute).replaceAll(path.sep, '/')] = {
        content: fs.readFileSync(absolute, 'utf8'),
      };
  }
  return sources;
}
export function compileContracts(): Artifacts {
  const input = {
    language: 'Solidity',
    sources: sourcesIn(path.join(root, 'contracts')),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai',
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
          '': ['ast'],
        },
      },
    },
  };
  // solc owns the compiler-output schema; validate every ABI before exposing it.
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (name: string) => {
        const dependencyRoot = fs.existsSync(
          path.join(root, 'node_modules', name),
        )
          ? path.join(root, 'node_modules')
          : path.join(root, '..', 'node_modules');
        const absolute = path.resolve(dependencyRoot, name);
        if (!absolute.startsWith(dependencyRoot + path.sep))
          return { error: 'Import outside dependencies' };
        try {
          return { contents: fs.readFileSync(absolute, 'utf8') };
        } catch {
          return { error: `Missing dependency: ${name}` };
        }
      },
    }),
  ) as CompilerOutput;
  const errors = (output.errors || []).filter((e) => e.severity === 'error');
  if (errors.length)
    throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  const artifacts: Artifacts = {};
  for (const [source, contracts] of Object.entries(output.contracts || {}))
    for (const [name, value] of Object.entries(contracts)) {
      if (source.startsWith('contracts/')) {
        new Interface(value.abi);
        artifacts[name] = {
          source,
          abi: value.abi,
          bytecode: '0x' + value.evm.bytecode.object,
          deployedBytecode: '0x' + value.evm.deployedBytecode.object,
        };
      }
    }
  return artifacts;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const artifacts = compileContracts();
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'build', 'artifacts.json'),
    JSON.stringify(
      { compiler: solc.version(), evmVersion: 'shanghai', artifacts },
      null,
      2,
    ) + '\n',
  );
  for (const [name, a] of Object.entries(artifacts))
    if (a.bytecode !== '0x')
      console.log(
        `${name}: ${(a.deployedBytecode.length - 2) / 2} runtime bytes`,
      );
}

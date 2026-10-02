import { writeFile } from 'node:fs/promises';
import { Interface, type FunctionFragment, type ParamType } from 'ethers';
import { compileContracts } from './compile.ts';

function valueType(param: ParamType, input: boolean): string {
  if (param.baseType === 'array')
    return `readonly (${valueType(param.arrayChildren!, input)})[]`;
  if (param.baseType === 'tuple') {
    const children = param.components!;
    const tuple = `readonly [${children.map((child) => valueType(child, input)).join(', ')}]`;
    const named = children.filter((child) => child.name);
    if (named.length !== children.length) return tuple;
    const object = `{ ${named.map((child) => `${JSON.stringify(child.name)}: ${valueType(child, input)}`).join('; ')} }`;
    return input ? `${tuple} | ${object}` : `${tuple} & ${object}`;
  }
  if (/^u?int/.test(param.type)) return input ? 'BigNumberish' : 'bigint';
  if (param.type === 'address') return input ? 'AddressLike' : 'string';
  if (param.type === 'bool') return 'boolean';
  if (/^bytes/.test(param.type)) return input ? 'BytesLike' : 'string';
  if (param.type === 'string') return 'string';
  throw new Error(`Unsupported binding type ${param.type}`);
}

function outputType(fragment: FunctionFragment): string {
  const values = fragment.outputs;
  if (!values.length) return 'void';
  if (values.length === 1) return valueType(values[0], false);
  const tuple = `readonly [${values.map((value) => valueType(value, false)).join(', ')}]`;
  const named = values.filter((value) => value.name);
  return `${tuple}${named.length ? ` & { ${named.map((value) => `${JSON.stringify(value.name)}: ${valueType(value, false)}`).join('; ')} }` : ''}`;
}

const artifacts = compileContracts();
let source = `// Derived from the unchanged Solidity ABI. Regenerate with npm run bindings.
import type { AddressLike, BaseContract, BigNumberish, BytesLike, ContractRunner, ContractTransactionResponse, Overrides } from 'ethers';
export type ReadMethod<Args extends readonly unknown[], Output> = ((...args: [...Args, Overrides?]) => Promise<Output>) & { staticCall(...args: [...Args, Overrides?]): Promise<Output> };
export type WriteMethod<Args extends readonly unknown[], Output = void> = ((...args: [...Args, Overrides?]) => Promise<ContractTransactionResponse>) & { staticCall(...args: [...Args, Overrides?]): Promise<Output> };
`;
const names: string[] = [];
for (const [name, artifact] of Object.entries(artifacts)) {
  names.push(name);
  const methods = new Map<string, string[]>();
  new Interface(artifact.abi).forEachFunction((fragment) => {
    const method = `${fragment.constant ? 'ReadMethod' : 'WriteMethod'}<[${fragment.inputs.map((input) => valueType(input, true)).join(', ')}], ${outputType(fragment)}>`;
    const key = fragment.name;
    methods.set(key, [...(methods.get(key) ?? []), method]);
    methods.set(fragment.format('sighash'), [method]);
  });
  source += `export interface ${name} extends Omit<BaseContract, 'connect' | 'target'> { target: string; connect(runner: ContractRunner | null): ${name};\n`;
  for (const [methodName, types] of methods)
    source += `readonly ${JSON.stringify(methodName)}: ${types.join(' & ')};\n`;
  source += '}\n';
}
source += `export type ContractBindings = { ${names.map((name) => `${JSON.stringify(name)}: ${name}`).join('; ')} };\n`;
await writeFile(new URL('../test/contracts.ts', import.meta.url), source);

import { unserialize } from 'locutus/php/var';

export function tryCatch<T extends (...args: any[]) => any>(fn: T) {
  try {
    const origConsoleError = console.error;
    console.error = () => {};
    const result = fn();
    console.error = origConsoleError;
    return result;
  } catch (err) {
    return null;
  }
}

export function maybeUnserialize(val: any) {
  if (typeof val === 'string') {
    const result = tryCatch(() => unserialize(val));
    return result === false ? val : result ?? val;
  } else {
    return val;
  }
}

export function maybeUnserializeMeta(meta: { meta_key: string | null; meta_value: string | null }) {
  return {
    ...meta,
    meta_value: maybeUnserialize(meta.meta_value),
  };
}

export function uniq<T>(arr: T[]) {
  return [...new Set(arr)];
}

export async function replaceAsync(string: string, searchValue: string | RegExp, replaceValue: string): Promise<string>;
export async function replaceAsync(
  string: string,
  searchValue: string | RegExp,
  replacer: (substring: string, ...args: any[]) => Promise<string> | string,
): Promise<string>;
export async function replaceAsync(
  string: string,
  searchValue: string | RegExp,
  replacer: string | ((substring: string, ...args: any[]) => Promise<string> | string),
): Promise<string> {
  if (typeof replacer === 'function') {
    const values: (string | Promise<string>)[] = [];
    string.replace(searchValue, (...args) => {
      values.push(replacer(...args));
      return '';
    });
    const resolvedValues = await Promise.all(values);
    return string.replace(searchValue, () => resolvedValues.shift()!);
  } else {
    return string.replace(searchValue, replacer);
  }
}

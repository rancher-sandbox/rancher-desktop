
export default {
  memberOfObject: <V = string>(obj: { [key: string]: any}, key: string): V => {
    return Object.entries(obj || {}).find(([k]) => k === key) as unknown as V;
  },
  memberOfComponent: <V = string>(obj: object | undefined, key: string): V => {
    return (obj as any as { [key: string]: any})[key] as V;
  },
};

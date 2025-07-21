export default {
  memberOfObject: <V = string>(obj: Record<string, any>, key: string): V => {
    return Object.entries(obj || {}).find(([k]) => k === key) as unknown as V;
  },
  memberOfComponent: <V = string>(obj: object | undefined, key: string): V => {
    return (obj as any as Record<string, any>)[key] as V;
  },
};

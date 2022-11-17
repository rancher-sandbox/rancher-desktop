declare module '@pkg/assets/*.yaml' {
  const content: any;
  export default content;
}

declare module '@pkg/assets/scripts/*' {
  const content: string;
  export default content;
}

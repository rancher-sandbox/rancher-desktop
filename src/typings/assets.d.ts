declare module '@/assets/*.yaml' {
  const content: any;
  export default content;
}

declare module '@/assets/blobs/*' {
  const content: string;
  export default content;
}

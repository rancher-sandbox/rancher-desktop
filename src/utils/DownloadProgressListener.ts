import stream from 'stream';

/**
 * DownloadProgressListener observes a stream pipe to monitor progress.
 */
export default class DownloadProgressListener extends stream.Transform {
  protected status: { current: number };

  /**
   * Construct a new DownloadProgressListener, which will update the passed-in
   * object on progress.  No events will be emitted to avoid redrawing the UI
   * too often; a timer/interval should be used instead.
   * @param status A object that will be modified when download progress occurs.
   * @param options Options to pass to {stream.Transform}.
   */
  constructor(status: { current: number }, options: stream.TransformOptions = {}) {
    super(options);
    this.status = status;
  }

  _transform(chunk: any, encoding: string, callback: stream.TransformCallback): void {
    if (encoding === 'buffer') {
      this.status.current += (chunk as Buffer).length;
    } else {
      this.status.current += (chunk as string).length;
    }
    callback(null, chunk);
  }
}

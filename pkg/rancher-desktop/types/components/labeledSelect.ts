export const LABEL_SELECT_KINDS = {
  GROUP:   'group',
  DIVIDER: 'divider',
  NONE:    'none',
};

export const LABEL_SELECT_NOT_OPTION_KINDS = [
  LABEL_SELECT_KINDS.GROUP,
  LABEL_SELECT_KINDS.DIVIDER,
];

/**
 * Options used When LabelSelect requests a new page
 */
export interface LabelSelectPaginateFnOptions<T = any> {
  /**
   * Current page
   */
  pageContent: T[],
  /**
   * page number to fetch
   */
  page: number,
  /**
   * number of items in the page to fetch
   */
  pageSize: number,
  /**
   * filter pagination filter. this is just a text string associated with user entered text
   */
  filter: string,
  /**
   * true if the result should only contain the fetched page, false if the result should be added to the pageContent
   */
  resetPage: boolean,
}

/**
 * Response that LabelSelect needs when it's requested a new page
 */
export interface LabelSelectPaginateFnResponse<T = any> {
  page: T[],
  pages: number,
  total: number
}

/**
 * Function called when LabelSelect needs a new page
 */
export type LabelSelectPaginateFn<T = any> = (opts: LabelSelectPaginateFnOptions<T>) => Promise<LabelSelectPaginateFnResponse<T>>

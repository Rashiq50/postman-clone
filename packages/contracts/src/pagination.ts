export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Every list endpoint returns this envelope. Collections are never returned as
 * a bare array — growing one into a paginated response later would be a
 * breaking change for every client.
 */
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PaginatorOptions<T, P> {
  fetchPage: (
    params: P,
  ) => Promise<{ items: T[]; nextCursor?: string; hasMore?: boolean }>;
  initialParams: P;
  cursorParamName: string;
}

export class Paginator<T, P> {
  private currentParams: P;
  private nextCursor: string | null = null;
  private hasMore = true;

  constructor(private options: PaginatorOptions<T, P>) {
    this.currentParams = { ...options.initialParams };
  }

  async nextPage(): Promise<T[]> {
    if (!this.hasMore) return [];

    if (this.nextCursor) {
      (this.currentParams as any)[this.options.cursorParamName] =
        this.nextCursor;
    }

    const result = await this.options.fetchPage(this.currentParams);

    this.nextCursor = result.nextCursor || null;
    this.hasMore =
      result.hasMore !== undefined ? result.hasMore : !!result.nextCursor;

    return result.items;
  }

  hasNext(): boolean {
    return this.hasMore;
  }
}

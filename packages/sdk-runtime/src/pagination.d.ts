export interface PaginatorOptions<T, P> {
    fetchPage: (params: P) => Promise<{
        items: T[];
        nextCursor?: string;
        hasMore?: boolean;
    }>;
    initialParams: P;
    cursorParamName: string;
}
export declare class Paginator<T, P> {
    private options;
    private currentParams;
    private nextCursor;
    private hasMore;
    constructor(options: PaginatorOptions<T, P>);
    nextPage(): Promise<T[]>;
    hasNext(): boolean;
}
//# sourceMappingURL=pagination.d.ts.map
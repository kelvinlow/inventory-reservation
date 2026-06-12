import { useState, useMemo } from 'react';
import type { Column, SortConfig } from '../../lib/types';
import { DEFAULT_PAGE_SIZE } from '../../lib/constants';

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  pageSize?: number;
  emptyIcon?: string;
  emptyMessage?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyExtractor,
  pageSize = DEFAULT_PAGE_SIZE,
  emptyIcon = '📋',
  emptyMessage = 'No data found',
  searchable = false,
  searchPlaceholder = 'Search...',
  searchKeys = [],
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortConfig | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch] = useState('');

  const filteredData = useMemo(() => {
    if (!search || !searchable || searchKeys.length === 0) return data;
    const lower = search.toLowerCase();
    return data.filter((item) =>
      searchKeys.some((key) => {
        const value = item[key];
        return value != null && String(value).toLowerCase().includes(lower);
      }),
    );
  }, [data, search, searchable, searchKeys]);

  const sortedData = useMemo(() => {
    if (!sort) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = a[sort.key];
      const bVal = b[sort.key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedData = sortedData.slice(startIndex, startIndex + pageSize);

  const handleSort = (key: string) => {
    setSort((prev) => {
      if (prev?.key === key) {
        return prev.direction === 'asc'
          ? { key, direction: 'desc' }
          : null;
      }
      return { key, direction: 'asc' };
    });
  };

  const getSortIndicator = (key: string) => {
    if (sort?.key !== key) return '↕';
    return sort.direction === 'asc' ? '↑' : '↓';
  };

  return (
    <div>
      {searchable && (
        <div className="data-table-toolbar">
          <div className="data-table-filters">
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              style={{ minWidth: 240 }}
            />
          </div>
          <span className="text-secondary" style={{ fontSize: '0.8125rem' }}>
            {filteredData.length} result{filteredData.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${col.sortable ? 'sortable' : ''} ${sort?.key === col.key ? 'sorted' : ''}`}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                  {col.sortable && (
                    <span className="sort-indicator">{getSortIndicator(col.key)}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <div className="data-table-empty">
                    <div className="data-table-empty-icon">{emptyIcon}</div>
                    <p>{emptyMessage}</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedData.map((item) => (
                <tr key={keyExtractor(item)}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      {col.render
                        ? col.render(item)
                        : (item[col.key] as React.ReactNode) ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="data-table-pagination">
            <span>
              Showing {startIndex + 1}–{Math.min(startIndex + pageSize, sortedData.length)} of{' '}
              {sortedData.length}
            </span>
            <div className="data-table-pagination-buttons">
              <button
                className="data-table-page-btn"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((page) => {
                  if (totalPages <= 7) return true;
                  if (page === 1 || page === totalPages) return true;
                  if (Math.abs(page - safeCurrentPage) <= 1) return true;
                  return false;
                })
                .map((page, idx, arr) => (
                  <span key={page}>
                    {idx > 0 && arr[idx - 1] !== page - 1 && (
                      <span className="data-table-page-btn" style={{ cursor: 'default', opacity: 0.5 }}>
                        …
                      </span>
                    )}
                    <button
                      className={`data-table-page-btn ${safeCurrentPage === page ? 'active' : ''}`}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  </span>
                ))}
              <button
                className="data-table-page-btn"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

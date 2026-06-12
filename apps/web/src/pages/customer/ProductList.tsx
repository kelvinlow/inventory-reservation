import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { getStockLabel, getStockBadgeVariant } from '../../lib/utils';
import { getProductIcon } from '../../lib/constants';
import type { Product } from '../../lib/types';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';

export function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Products — Everest';
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getProducts();
      setProducts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="container page-content">
        <LoadingSpinner text="Loading products..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container page-content">
        <div className="empty-state">
          <div className="empty-state-icon">⚠️</div>
          <h2 className="empty-state-title">Failed to Load Products</h2>
          <p className="empty-state-description">{error}</p>
          <button className="btn btn-primary" onClick={loadProducts}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="container page-content">
        <div className="product-list-header">
          <h1>
            <span className="text-gradient">Products</span>
          </h1>
          <p>Browse our inventory and reserve items</p>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <h2 className="empty-state-title">No Products Available</h2>
          <p className="empty-state-description">
            Check back soon — new products are being added regularly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container page-content">
      <div className="product-list-header">
        <h1>
          <span className="text-gradient">Products</span>
        </h1>
        <p>Browse our inventory and reserve items</p>
      </div>

      <div className="product-grid stagger-children">
        {products.map((product) => {
          const stockLabel = getStockLabel(product.availableStock);
          const stockVariant = getStockBadgeVariant(
            product.availableStock,
            product.totalStock,
          );
          const stockClass =
            product.availableStock === 0
              ? 'out-of-stock'
              : product.availableStock <= 5
                ? 'low-stock'
                : 'in-stock';

          return (
            <Card
              key={product.id}
              gradient
              interactive
              onClick={() => navigate(`/products/${product.sku}`)}
            >
              <div className="product-card">
                <div className="product-card-header">
                  <div>
                    <div className="product-card-name">{product.name}</div>
                    <div className="product-card-sku">SKU: {product.sku}</div>
                  </div>
                  <div className="product-card-icon">
                    {getProductIcon(product.id)}
                  </div>
                </div>

                {product.description && (
                  <p className="product-card-description">
                    {product.description}
                  </p>
                )}

                <div className="product-card-footer">
                  <div className="product-stock-info">
                    <span className={`product-stock-count ${stockClass}`}>
                      {product.availableStock}
                    </span>
                    <span className="product-stock-label">Available</span>
                  </div>
                  <Badge variant={stockVariant}>{stockLabel}</Badge>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

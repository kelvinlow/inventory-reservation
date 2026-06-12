import type { Env } from '../types/env.js';
import type { ProductWithStock } from '../types/index.js';
import { ProductRepository } from '../repositories/product.js';
import { ProductNotFoundError } from '../utils/errors.js';

export class ProductService {
  private productRepo: ProductRepository;

  constructor(private env: Env) {
    this.productRepo = new ProductRepository(env.DB);
  }

  /**
   * List all active products with their stock information.
   */
  async listActiveProducts(): Promise<ProductWithStock[]> {
    return this.productRepo.findAllActive();
  }

  /**
   * Get a single product by SKU with stock information.
   */
  async getProductBySku(sku: string): Promise<ProductWithStock> {
    const product = await this.productRepo.findBySkuWithStock(sku);
    if (!product) {
      throw new ProductNotFoundError(sku);
    }
    return product;
  }

  /**
   * Get a single product by ID with stock information.
   */
  async getProductById(id: string): Promise<ProductWithStock> {
    const product = await this.productRepo.findByIdWithStock(id);
    if (!product) {
      throw new ProductNotFoundError(id);
    }
    return product;
  }
}

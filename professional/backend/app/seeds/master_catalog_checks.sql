-- Read-only checks of the master catalog (the old seed's verification queries 6c-6e,
-- renamed). Run each SELECT on its own after app/seeds/master_catalog_seed.sql.

-- -----------------------------------------------------------------------------
-- 6c. VERIFICATION: duplicate checks across the whole catalog (read-only).
--     Every row should say duplicates = 0.
-- -----------------------------------------------------------------------------
SELECT 'category slug (per country)' AS natural_key, count(*) AS duplicates
  FROM (SELECT country_code, slug FROM professional.catalog_categories GROUP BY 1, 2 HAVING count(*) > 1) d
UNION ALL
SELECT 'subcategory slug (per category)', count(*)
  FROM (SELECT category_id, slug FROM professional.catalog_subcategories GROUP BY 1, 2 HAVING count(*) > 1) d
UNION ALL
SELECT 'brand slug', count(*)
  FROM (SELECT slug FROM professional.catalog_brands GROUP BY 1 HAVING count(*) > 1) d
UNION ALL
SELECT 'product slug (per country)', count(*)
  FROM (SELECT country_code, slug FROM professional.catalog_products GROUP BY 1, 2 HAVING count(*) > 1) d
UNION ALL
SELECT 'product name (per country, active)', count(*)
  FROM (SELECT country_code, normalized_name FROM professional.catalog_products WHERE is_active GROUP BY 1, 2 HAVING count(*) > 1) d
UNION ALL
SELECT 'variant slug (per product)', count(*)
  FROM (SELECT product_id, slug FROM professional.catalog_product_variants GROUP BY 1, 2 HAVING count(*) > 1) d
UNION ALL
SELECT 'unit code', count(*)
  FROM (SELECT code FROM professional.catalog_units GROUP BY 1 HAVING count(*) > 1) d;

-- -----------------------------------------------------------------------------
-- 6d. STEEL VERIFICATION (read-only). Run each SELECT on its own in pgAdmin.
-- -----------------------------------------------------------------------------
-- Steel category
SELECT c.id, c.country_code, c.slug, c.name, c.is_active
  FROM professional.catalog_categories c
 WHERE c.country_code = 'IN' AND c.slug = 'steel';

-- Steel subcategories (20 expected)
SELECT s.id, s.slug, s.name, s.sort_order, s.is_active
  FROM professional.catalog_subcategories s
  JOIN professional.catalog_categories c ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug = 'steel'
 ORDER BY s.sort_order, s.name;

-- Steel brands (13 expected) and how many Steel products each has
SELECT b.id, b.slug, b.name, b.manufacturer, b.is_active, count(p.id) AS steel_products
  FROM professional.catalog_brands b
  LEFT JOIN professional.catalog_products p
         ON p.brand_id = b.id
        AND p.subcategory_id IN (SELECT s.id FROM professional.catalog_subcategories s
                                   JOIN professional.catalog_categories c ON c.id = s.category_id
                                  WHERE c.country_code = 'IN' AND c.slug = 'steel')
 WHERE b.slug IN ('tata-tiscon', 'jsw-neosteel', 'sail', 'vizag-steel', 'jindal-panther', 'kamdhenu', 'shyam-steel', 'electrosteel', 'tata-structura', 'apl-apollo', 'jindal-stainless', 'tata-bluescope', 'generic-steel')
 GROUP BY b.id, b.slug, b.name, b.manufacturer, b.is_active
 ORDER BY b.sort_order, b.name;

-- Steel products
SELECT p.id, s.name AS subcategory, b.name AS brand, p.name AS product, u.code AS unit,
       p.product_type, p.standard_code, p.is_active,
       (SELECT count(*) FROM professional.catalog_product_variants v WHERE v.product_id = p.id) AS variants
  FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
  LEFT JOIN professional.catalog_brands b   ON b.id = p.brand_id
  LEFT JOIN professional.catalog_units u    ON u.id = p.unit_id
 WHERE c.country_code = 'IN' AND c.slug = 'steel'
 ORDER BY s.sort_order, b.name, p.name;

-- Steel product variants
SELECT p.name AS product, v.id, v.slug, v.name AS variant, COALESCE(vu.code, u.code) AS unit,
       v.specifications, v.sort_order, v.is_active
  FROM professional.catalog_product_variants v
  JOIN professional.catalog_products p      ON p.id = v.product_id
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
  LEFT JOIN professional.catalog_units u    ON u.id = p.unit_id
  LEFT JOIN professional.catalog_units vu   ON vu.id = v.unit_id
 WHERE c.country_code = 'IN' AND c.slug = 'steel'
 ORDER BY s.sort_order, p.name, v.sort_order;

-- Counts by category / subcategory
SELECT c.name AS category, s.name AS subcategory,
       count(DISTINCT p.id) AS products, count(v.id) AS variants
  FROM professional.catalog_subcategories s
  JOIN professional.catalog_categories c ON c.id = s.category_id
  LEFT JOIN professional.catalog_products p ON p.subcategory_id = s.id
  LEFT JOIN professional.catalog_product_variants v ON v.product_id = p.id
 WHERE c.country_code = 'IN' AND c.slug = 'steel'
 GROUP BY ROLLUP ((c.name), (s.sort_order, s.name))
 ORDER BY c.name NULLS LAST, s.sort_order NULLS LAST;

-- Orphan products: a broken subcategory / category / brand / unit reference
-- (expected: no rows)
SELECT p.id, p.slug, p.name,
       (s.id IS NULL) AS missing_subcategory, (c.id IS NULL) AS missing_category,
       (p.brand_id IS NOT NULL AND b.id IS NULL) AS missing_brand,
       (p.unit_id IS NULL OR u.id IS NULL) AS missing_unit
  FROM professional.catalog_products p
  LEFT JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  LEFT JOIN professional.catalog_categories c    ON c.id = s.category_id
  LEFT JOIN professional.catalog_brands b        ON b.id = p.brand_id
  LEFT JOIN professional.catalog_units u         ON u.id = p.unit_id
 WHERE p.country_code = 'IN'
   AND (s.id IS NULL OR c.id IS NULL OR (p.brand_id IS NOT NULL AND b.id IS NULL)
        OR (c.slug = 'steel' AND (p.unit_id IS NULL OR u.id IS NULL)));

-- Orphan variants: a broken product / unit reference (expected: no rows)
SELECT v.id, v.slug, v.name,
       (p.id IS NULL) AS missing_product,
       (v.unit_id IS NOT NULL AND vu.id IS NULL) AS missing_unit
  FROM professional.catalog_product_variants v
  LEFT JOIN professional.catalog_products p ON p.id = v.product_id
  LEFT JOIN professional.catalog_units vu   ON vu.id = v.unit_id
 WHERE p.id IS NULL OR (v.unit_id IS NOT NULL AND vu.id IS NULL);

-- Duplicate Steel products / variants (expected: no rows)
SELECT 'product slug' AS duplicate_of, p.slug AS value, count(*) AS rows
  FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug = 'steel'
 GROUP BY p.slug HAVING count(*) > 1
UNION ALL
SELECT 'product name', p.normalized_name, count(*)
  FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug = 'steel'
 GROUP BY p.normalized_name HAVING count(*) > 1
UNION ALL
SELECT 'variant slug of ' || p.slug, v.slug, count(*)
  FROM professional.catalog_product_variants v
  JOIN professional.catalog_products p      ON p.id = v.product_id
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug = 'steel'
 GROUP BY p.slug, v.slug HAVING count(*) > 1;

-- -----------------------------------------------------------------------------
-- 6e. CEMENT VERIFICATION (read-only). Run each SELECT on its own in pgAdmin.
--     A new catalog section can copy these, changing 'cement' to its category slug.
-- -----------------------------------------------------------------------------
-- Cement subcategories (4 expected) with their products and variants
SELECT s.name AS subcategory, count(DISTINCT p.id) AS products, count(v.id) AS variants
  FROM professional.catalog_subcategories s
  JOIN professional.catalog_categories c ON c.id = s.category_id
  LEFT JOIN professional.catalog_products p ON p.subcategory_id = s.id
  LEFT JOIN professional.catalog_product_variants v ON v.product_id = p.id
 WHERE c.country_code = 'IN' AND c.slug = 'cement'
 GROUP BY s.sort_order, s.name
 ORDER BY s.sort_order;

-- Cement brands (8 expected) and how many Cement products each has
SELECT b.slug, b.name, b.manufacturer, b.is_active, (b.logo_url IS NOT NULL) AS has_logo, count(p.id) AS cement_products
  FROM professional.catalog_brands b
  JOIN professional.catalog_products p ON p.brand_id = b.id
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug = 'cement'
 GROUP BY b.slug, b.name, b.manufacturer, b.is_active, b.logo_url, b.sort_order
 ORDER BY b.sort_order;

-- What a supplier sees, dropdown by dropdown: Cement -> subcategory -> brand
-- -> product -> variant, with the unit and the Grade / Size the listing copies.
SELECT s.name AS subcategory, b.name AS brand, p.name AS product,
       COALESCE(v.name, '(sold in one form)') AS variant,
       COALESCE(vu.code, u.code) AS unit,
       p.specifications->>'Grade' AS grade,
       v.specifications->>'Size' AS size
  FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id AND s.is_active
  JOIN professional.catalog_categories c    ON c.id = s.category_id AND c.is_active
  JOIN professional.catalog_brands b        ON b.id = p.brand_id AND b.is_active
  LEFT JOIN professional.catalog_units u    ON u.id = p.unit_id
  LEFT JOIN professional.catalog_product_variants v ON v.product_id = p.id AND v.is_active
  LEFT JOIN professional.catalog_units vu   ON vu.id = v.unit_id
 WHERE c.country_code = 'IN' AND c.slug = 'cement' AND p.is_active
 ORDER BY s.sort_order, b.sort_order, p.name, v.sort_order;

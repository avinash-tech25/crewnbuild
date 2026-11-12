-- #############################################################################
--  CREWNBUILD -- MASTER CATALOG SEED (schema professional, tables catalog_*)
--  Ported from the old sql_scripts/master_catalog_seed.sql: the same catalog data,
--  the same rules. India only (country_code 'IN').
--
--  Database: crewnbuild (or crewnbuild_test)   Schema: professional   PostgreSQL 18
--
--  WHAT CHANGED FROM THE OLD SCRIPT
--    * Data only. The catalog tables are created by the Professional migrations
--      (the R5 baseline), from app/modules/catalog/models.py, which follow the
--      old script's live schema and its delete rules. The old script's DDL part
--      is gone; the run stops, changing nothing, if a catalog table is missing.
--    * Tables master_* -> catalog_*; master_product_images -> catalog_product_media;
--      the variant and media column master_product_id -> product_id. Every key is
--      a UUID (the database default uuidv7()).
--    * One statement: a single DO block, so a migration (op.execute) or
--      app/seeds/seed_master_catalog.py can run it as it is. The run's own result
--      tables are temporary and private to the run. The old read-only
--      verification queries are in master_catalog_checks.sql.
--    * CHECK 10 and 12 count the marketplace's supplier_listings and
--      supplier_listing_price_tiers before and after the run.
--
--  NO "ON CONFLICT" ANYWHERE: every row is looked up by its natural key first and
--  inserted only when missing (catalog_categories and catalog_products are unique
--  on (country_code, slug) through PARTIAL unique indexes -- WHERE country_code
--  IS NOT NULL -- so a plain ON CONFLICT (country_code, slug) has no matching
--  constraint and fails with SQLSTATE 42P10).
--
--  THE CATALOG IN THIS FILE (one CATALOG SECTION each in the DATA part)
--    Cement OPC Cement / PPC Cement / PSC Cement / White Cement
--    Brands UltraTech, ACC, Ambuja, JK Cement, Dalmia, Ramco, JSW Cement,
--           Birla White
--    Units  Bag
--
--    Steel  TMT Bars / Structural Steel / Steel Sections / Steel Angles /
--           Steel Channels / Steel Beams / Steel Plates / Steel Sheets /
--           Steel Pipes / GI Steel / MS Pipes / Binding Wire / Steel Mesh /
--           Stainless Steel / Steel Flats / Steel Rounds / Steel Squares /
--           Steel Hollow Sections / Roofing Steel / Steel Fasteners
--    Brands Tata Tiscon, JSW Neosteel, SAIL, Vizag Steel, Jindal Panther,
--           Kamdhenu, Shyam Steel, Electrosteel, Tata Structura, APL Apollo,
--           Jindal Stainless, Tata BlueScope, Generic Steel
--    Units  Kg, Tonne, Piece, Sheet, Sq. Ft. (reused by code when present)
--
--    Hierarchy, linked by ids the script looks up (never by text across tables):
--      catalog_categories
--        -> catalog_subcategories.category_id
--          -> catalog_products.subcategory_id (+ brand_id -> catalog_brands,
--                                                unit_id  -> catalog_units)
--            -> catalog_product_variants.product_id (+ unit_id)
--
--  HOW TO RUN
--    python -m app.seeds.seed_master_catalog       (from professional/backend)
--    psql -d crewnbuild -f app/seeds/master_catalog_seed.sql
--      Messages: "Added ..." / "Exists ..." per row, then the CHECK lines.
--
--  ADDING A CATALOG -- Tiles, Electrical, Plumbing ... (no new SQL file, ever)
--    Every catalog is one CATALOG SECTION in the DATA part of the DO block,
--    between "CATALOG SECTION: <NAME>" banners. Each section declares:
--      <name>_brands      brands (reused by slug; shared by every catalog)
--      <name>_categories  its category + subcategories (reused by slug)
--      <name>_products    products + their variants (reused by slug)
--      <name>_uses        optional: one line per subcategory, used to build
--                         highlights / FAQs for a product that lists none
--    and units go in the one shared list, cfg_units.
--    To add Tiles:
--      1. Copy the commented TEMPLATE section, rename tiles_*, fill it in.
--      2. Add tiles_* to the COMBINE lines just below the sections.
--      3. Add any new unit (Box, SqFt ...) to cfg_units if it is missing.
--      4. Run it. Only the new rows are added; Steel, Cement and every admin
--         edit and image stay as they are.
--    The run stops, changing nothing, if two sections use the same category or
--    product slug. Everything already in the database is found by its natural
--    key and reused; only what is missing is inserted:
--      unit (code)   brand (slug)   category (country_code, slug)
--      subcategory (category_id, slug)   product (country_code, slug)
--      variant (product_id, slug)
--    Never change an existing slug: slugs are the keys.
--
--  SAFE TO RUN AGAIN
--    * Existing rows are LEFT AS THEY ARE (admin edits, images and logos stay)
--      unless cfg_update_existing = true, which re-applies the listed fields.
--    * Nothing is ever deleted. Retiring is opt-in: cfg_retire_unlisted = true
--      deactivates (is_active = false) this country's categories, subcategories
--      and products that the lists no longer contain -- never DELETE.
--    * One statement: any error or failed check rolls everything back.
--
--  NEVER WRITTEN BY THIS SCRIPT
--    * images: catalog_categories.image_url, catalog_subcategories.image_url,
--      catalog_brands.logo_url and catalog_product_media / files -- uploaded by
--      the admin in Admin > Master Catalog
--    * supplier data: listings, price tiers, carts, orders, requests, users.
--      CHECK 10-12 prove none were written.
-- #############################################################################

DO $seed$
DECLARE
    -- =========================================================================
    -- SETTINGS
    -- =========================================================================
    cfg_country_code    varchar := 'IN';   -- 'IN' India
    cfg_update_existing boolean := false;  -- true: overwrite the listed fields of rows that exist
    cfg_retire_unlisted boolean := false;  -- true: deactivate (never delete) this country's
                                           --       categories / subcategories / products not listed below

    -- Returns & Exchange Policy for a NEW product that does not carry its own
    -- "returns_exchange_policy". Shown on the product page as written.
    cfg_returns_policy text := $policy$1. This product is non-returnable.
2. Replacement available within 24 hours of delivery for:
   - Damaged or defective product
   - Wrong or missing item
3. Product cannot be returned once opened or used
4. Refer to Refund Policy for complete details$policy$;

    -- =========================================================================
    -- DATA -- the master catalog
    -- =========================================================================
    -- Units, shared by every catalog. Reused by code; listed here so a fresh
    -- database gets them too. Add a unit only if your catalog needs a new one.
    --   unit_family: PACK | COUNT | WEIGHT | LENGTH | AREA | VOLUME | OTHER
    cfg_units jsonb := $j$[
      {"code": "Bag", "name": "Bag", "unit_family": "PACK", "sort_order": 10},
      {"code": "Kg", "name": "Kg", "unit_family": "WEIGHT", "sort_order": 30},
      {"code": "Tonne", "name": "Tonne", "unit_family": "WEIGHT", "sort_order": 31},
      {"code": "Piece", "name": "Piece", "unit_family": "COUNT", "sort_order": 20},
      {"code": "Sheet", "name": "Sheet", "unit_family": "COUNT", "sort_order": 25},
      {"code": "SqFt", "name": "Sq. Ft.", "unit_family": "AREA", "sort_order": 40}
    ]$j$;

    -- Every catalog section below uses the same four lists:
    --   <name>_brands      [ { "slug", "name", "manufacturer", "description", "sort_order" } ]
    --                      No logo here: upload it in Admin > Master Catalog > Brands.
    --   <name>_categories  [ { "slug", "name", "description", "sort_order",
    --                          "subcategories": [ { "slug", "name", "description", "sort_order" } ] } ]
    --                      No image here: upload it in Admin > Master Catalog > Categories.
    --   <name>_products    [ { "slug", "name", "category", "subcategory", "brand", "unit",
    --                          "product_type", "standard", "keywords", "short_description", "description",
    --                          "specifications": {}, "highlights": [], "faqs": [{"question","answer"}],
    --                          "returns_exchange_policy",
    --                          "variants": [ { "slug", "name", "unit" (only if not the product's),
    --                                          "size", "grade", "specifications": {} } ] } ]
    --                      "category" / "subcategory" / "brand" are slugs, "unit" a unit code;
    --                      "brand": null for a generic product. A product sold in one form
    --                      has "variants": [] -- no size is invented. A variant's "size" /
    --                      "grade" are added to its specifications as Size / Pack Size / Grade.
    --                      No images here: upload them in Admin > Master Catalog > Products.
    --   <name>_uses        { "<subcategory slug>": "what it is used for" }   (optional)
    -- Lengths the supplier listing copies: product name <= 160, variant name <= 80,
    -- product_type <= 80, specifications "Grade" <= 80, category name <= 80.

    -- #########################################################################
    -- CATALOG SECTION: CEMENT
    -- #########################################################################
    cement_brands jsonb := $j$[
      {"slug": "ultratech", "name": "UltraTech", "manufacturer": "UltraTech Cement Limited", "description": "Grey cement from UltraTech Cement (Aditya Birla Group).", "sort_order": 10},
      {"slug": "acc", "name": "ACC", "manufacturer": "ACC Limited", "description": "Grey cement from ACC.", "sort_order": 20},
      {"slug": "ambuja", "name": "Ambuja", "manufacturer": "Ambuja Cements Limited", "description": "Grey cement from Ambuja Cements.", "sort_order": 30},
      {"slug": "jk-cement", "name": "JK Cement", "manufacturer": "JK Cement Limited", "description": "Grey cement from JK Cement.", "sort_order": 40},
      {"slug": "dalmia", "name": "Dalmia", "manufacturer": "Dalmia Cement (Bharat) Limited", "description": "Grey cement from Dalmia Cement.", "sort_order": 50},
      {"slug": "ramco", "name": "Ramco", "manufacturer": "The Ramco Cements Limited", "description": "Grey cement from The Ramco Cements.", "sort_order": 60},
      {"slug": "jsw-cement", "name": "JSW Cement", "manufacturer": "JSW Cement Limited", "description": "Grey cement from JSW Cement.", "sort_order": 70},
      {"slug": "birla-white", "name": "Birla White", "manufacturer": "UltraTech Cement Limited", "description": "White cement from UltraTech Cement's Birla White.", "sort_order": 80}
    ]$j$;

    -- Cement types are SUBCATEGORIES of one Cement category; the grade (43 / 53)
    -- is part of the product, as Fe 500 / Fe 550 is for TMT bars.
    cement_categories jsonb := $j$[
      {"slug": "cement", "name": "Cement", "description": "Ordinary Portland, Portland Pozzolana, Portland Slag and White cement for construction.", "sort_order": 20, "subcategories": [{"slug": "opc-cement", "name": "OPC Cement", "description": "Ordinary Portland Cement, 43 and 53 grade (IS 269:2015).", "sort_order": 10}, {"slug": "ppc-cement", "name": "PPC Cement", "description": "Portland Pozzolana Cement, fly ash based (IS 1489 (Part 1):2015).", "sort_order": 20}, {"slug": "psc-cement", "name": "PSC Cement", "description": "Portland Slag Cement (IS 455:2015).", "sort_order": 30}, {"slug": "white-cement", "name": "White Cement", "description": "White Portland Cement (IS 8042:2015).", "sort_order": 40}]}
    ]$j$;

    -- Grey cement is sold in the standard 50 kg bag. White cement pack sizes
    -- differ by brand and region, so none is invented: its variants are added
    -- in Admin > Master Catalog > Products once confirmed.
    cement_products jsonb := $j$[
      {"slug": "ultratech-opc-43-grade-cement", "name": "UltraTech OPC 43 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "ultratech", "unit": "Bag", "product_type": "OPC 43 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 43 ordinary portland grey", "short_description": "UltraTech Ordinary Portland Cement, 43 grade, in 50 kg bags.", "description": "UltraTech 43 grade Ordinary Portland Cement conforming to IS 269:2015, for general construction, plastering and masonry. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 43", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "43 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "ultratech-opc-53-grade-cement", "name": "UltraTech OPC 53 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "ultratech", "unit": "Bag", "product_type": "OPC 53 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 53 ordinary portland grey", "short_description": "UltraTech Ordinary Portland Cement, 53 grade, in 50 kg bags.", "description": "UltraTech 53 grade Ordinary Portland Cement conforming to IS 269:2015, for RCC, precast and high strength concrete. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 53", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "53 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "ultratech-ppc-cement", "name": "UltraTech PPC Cement", "category": "cement", "subcategory": "ppc-cement", "brand": "ultratech", "unit": "Bag", "product_type": "PPC Cement", "standard": "IS 1489 (Part 1):2015", "keywords": "cement siment ppc pozzolana fly ash grey", "short_description": "UltraTech Portland Pozzolana Cement in 50 kg bags.", "description": "UltraTech fly ash based Portland Pozzolana Cement conforming to IS 1489 (Part 1):2015, for general construction, masonry and plastering. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Pozzolana Cement (Fly Ash Based)", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "ultratech-psc-cement", "name": "UltraTech PSC Cement", "category": "cement", "subcategory": "psc-cement", "brand": "ultratech", "unit": "Bag", "product_type": "PSC Cement", "standard": "IS 455:2015", "keywords": "cement siment psc slag grey", "short_description": "UltraTech Portland Slag Cement in 50 kg bags.", "description": "UltraTech Portland Slag Cement conforming to IS 455:2015, for mass concrete, foundations and marine or sulphate-exposed work. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Slag Cement", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "acc-opc-53-grade-cement", "name": "ACC OPC 53 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "acc", "unit": "Bag", "product_type": "OPC 53 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 53 ordinary portland grey", "short_description": "ACC Ordinary Portland Cement, 53 grade, in 50 kg bags.", "description": "ACC 53 grade Ordinary Portland Cement conforming to IS 269:2015, for RCC, precast and high strength concrete. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 53", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "53 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "acc-ppc-cement", "name": "ACC PPC Cement", "category": "cement", "subcategory": "ppc-cement", "brand": "acc", "unit": "Bag", "product_type": "PPC Cement", "standard": "IS 1489 (Part 1):2015", "keywords": "cement siment ppc pozzolana fly ash grey", "short_description": "ACC Portland Pozzolana Cement in 50 kg bags.", "description": "ACC fly ash based Portland Pozzolana Cement conforming to IS 1489 (Part 1):2015, for general construction, masonry and plastering. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Pozzolana Cement (Fly Ash Based)", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "ambuja-opc-53-grade-cement", "name": "Ambuja OPC 53 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "ambuja", "unit": "Bag", "product_type": "OPC 53 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 53 ordinary portland grey", "short_description": "Ambuja Ordinary Portland Cement, 53 grade, in 50 kg bags.", "description": "Ambuja 53 grade Ordinary Portland Cement conforming to IS 269:2015, for RCC, precast and high strength concrete. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 53", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "53 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "ambuja-ppc-cement", "name": "Ambuja PPC Cement", "category": "cement", "subcategory": "ppc-cement", "brand": "ambuja", "unit": "Bag", "product_type": "PPC Cement", "standard": "IS 1489 (Part 1):2015", "keywords": "cement siment ppc pozzolana fly ash grey", "short_description": "Ambuja Portland Pozzolana Cement in 50 kg bags.", "description": "Ambuja fly ash based Portland Pozzolana Cement conforming to IS 1489 (Part 1):2015, for general construction, masonry and plastering. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Pozzolana Cement (Fly Ash Based)", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "jk-cement-opc-43-grade-cement", "name": "JK Cement OPC 43 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "jk-cement", "unit": "Bag", "product_type": "OPC 43 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 43 ordinary portland grey", "short_description": "JK Cement Ordinary Portland Cement, 43 grade, in 50 kg bags.", "description": "JK Cement 43 grade Ordinary Portland Cement conforming to IS 269:2015, for general construction, plastering and masonry. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 43", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "43 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "jk-cement-opc-53-grade-cement", "name": "JK Cement OPC 53 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "jk-cement", "unit": "Bag", "product_type": "OPC 53 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 53 ordinary portland grey", "short_description": "JK Cement Ordinary Portland Cement, 53 grade, in 50 kg bags.", "description": "JK Cement 53 grade Ordinary Portland Cement conforming to IS 269:2015, for RCC, precast and high strength concrete. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 53", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "53 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "jk-cement-ppc-cement", "name": "JK Cement PPC Cement", "category": "cement", "subcategory": "ppc-cement", "brand": "jk-cement", "unit": "Bag", "product_type": "PPC Cement", "standard": "IS 1489 (Part 1):2015", "keywords": "cement siment ppc pozzolana fly ash grey", "short_description": "JK Cement Portland Pozzolana Cement in 50 kg bags.", "description": "JK Cement fly ash based Portland Pozzolana Cement conforming to IS 1489 (Part 1):2015, for general construction, masonry and plastering. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Pozzolana Cement (Fly Ash Based)", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "dalmia-opc-53-grade-cement", "name": "Dalmia OPC 53 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "dalmia", "unit": "Bag", "product_type": "OPC 53 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 53 ordinary portland grey", "short_description": "Dalmia Ordinary Portland Cement, 53 grade, in 50 kg bags.", "description": "Dalmia 53 grade Ordinary Portland Cement conforming to IS 269:2015, for RCC, precast and high strength concrete. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 53", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "53 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "dalmia-ppc-cement", "name": "Dalmia PPC Cement", "category": "cement", "subcategory": "ppc-cement", "brand": "dalmia", "unit": "Bag", "product_type": "PPC Cement", "standard": "IS 1489 (Part 1):2015", "keywords": "cement siment ppc pozzolana fly ash grey", "short_description": "Dalmia Portland Pozzolana Cement in 50 kg bags.", "description": "Dalmia fly ash based Portland Pozzolana Cement conforming to IS 1489 (Part 1):2015, for general construction, masonry and plastering. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Pozzolana Cement (Fly Ash Based)", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "dalmia-psc-cement", "name": "Dalmia PSC Cement", "category": "cement", "subcategory": "psc-cement", "brand": "dalmia", "unit": "Bag", "product_type": "PSC Cement", "standard": "IS 455:2015", "keywords": "cement siment psc slag grey", "short_description": "Dalmia Portland Slag Cement in 50 kg bags.", "description": "Dalmia Portland Slag Cement conforming to IS 455:2015, for mass concrete, foundations and marine or sulphate-exposed work. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Slag Cement", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "ramco-opc-53-grade-cement", "name": "Ramco OPC 53 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "ramco", "unit": "Bag", "product_type": "OPC 53 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 53 ordinary portland grey", "short_description": "Ramco Ordinary Portland Cement, 53 grade, in 50 kg bags.", "description": "Ramco 53 grade Ordinary Portland Cement conforming to IS 269:2015, for RCC, precast and high strength concrete. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 53", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "53 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "ramco-ppc-cement", "name": "Ramco PPC Cement", "category": "cement", "subcategory": "ppc-cement", "brand": "ramco", "unit": "Bag", "product_type": "PPC Cement", "standard": "IS 1489 (Part 1):2015", "keywords": "cement siment ppc pozzolana fly ash grey", "short_description": "Ramco Portland Pozzolana Cement in 50 kg bags.", "description": "Ramco fly ash based Portland Pozzolana Cement conforming to IS 1489 (Part 1):2015, for general construction, masonry and plastering. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Pozzolana Cement (Fly Ash Based)", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "jsw-cement-opc-53-grade-cement", "name": "JSW Cement OPC 53 Grade Cement", "category": "cement", "subcategory": "opc-cement", "brand": "jsw-cement", "unit": "Bag", "product_type": "OPC 53 Grade Cement", "standard": "IS 269:2015", "keywords": "cement siment opc 53 ordinary portland grey", "short_description": "JSW Cement Ordinary Portland Cement, 53 grade, in 50 kg bags.", "description": "JSW Cement 53 grade Ordinary Portland Cement conforming to IS 269:2015, for RCC, precast and high strength concrete. Supplied in 50 kg bags.", "specifications": {"Grade": "OPC 53", "Type": "Ordinary Portland Cement", "Compressive Strength (28 days, min)": "53 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "jsw-cement-ppc-cement", "name": "JSW Cement PPC Cement", "category": "cement", "subcategory": "ppc-cement", "brand": "jsw-cement", "unit": "Bag", "product_type": "PPC Cement", "standard": "IS 1489 (Part 1):2015", "keywords": "cement siment ppc pozzolana fly ash grey", "short_description": "JSW Cement Portland Pozzolana Cement in 50 kg bags.", "description": "JSW Cement fly ash based Portland Pozzolana Cement conforming to IS 1489 (Part 1):2015, for general construction, masonry and plastering. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Pozzolana Cement (Fly Ash Based)", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "jsw-cement-psc-cement", "name": "JSW Cement PSC Cement", "category": "cement", "subcategory": "psc-cement", "brand": "jsw-cement", "unit": "Bag", "product_type": "PSC Cement", "standard": "IS 455:2015", "keywords": "cement siment psc slag grey", "short_description": "JSW Cement Portland Slag Cement in 50 kg bags.", "description": "JSW Cement Portland Slag Cement conforming to IS 455:2015, for mass concrete, foundations and marine or sulphate-exposed work. Supplied in 50 kg bags.", "specifications": {"Type": "Portland Slag Cement", "Compressive Strength (28 days, min)": "33 MPa", "Initial Setting Time (min)": "30 minutes", "Final Setting Time (max)": "600 minutes"}, "variants": [{"slug": "50-kg-bag", "name": "50 kg Bag", "size": "50 kg"}]},
      {"slug": "birla-white-white-cement", "name": "Birla White White Cement", "category": "cement", "subcategory": "white-cement", "brand": "birla-white", "unit": "Bag", "product_type": "White Cement", "standard": "IS 8042:2015", "keywords": "cement white cement safed siment putty tile grout", "short_description": "Birla White White Portland Cement.", "description": "Birla White White Portland Cement conforming to IS 8042:2015, for decorative finishes, tile joints and white or coloured concrete and plaster.", "specifications": {"Type": "White Portland Cement"}, "variants": []}
    ]$j$;

    cement_uses jsonb := $j${
      "opc-cement": "RCC, precast, plastering and masonry work",
      "ppc-cement": "General construction, masonry, plastering and mass concrete",
      "psc-cement": "Mass concrete, foundations and marine or sulphate-exposed structures",
      "white-cement": "Decorative finishes, tile joints and white or coloured concrete and plaster"
    }$j$;

    -- #########################################################################
    -- CATALOG SECTION: STEEL
    -- #########################################################################
    steel_uses jsonb := $j${
      "tmt-bars": "High strength reinforcement for RCC foundations, columns, beams and slabs",
      "structural-steel": "Fabricated steel structures, sheds, industrial buildings and frames",
      "steel-sections": "Light structural framing, roof purlins, girts and fabrication",
      "steel-angles": "Trusses, frames, bracing, supports and fabrication work",
      "steel-channels": "Purlins, frames, columns and structural fabrication",
      "steel-beams": "Beams, columns, girders and heavy structural framing",
      "steel-plates": "Base plates, gusset plates, fabrication and flooring",
      "steel-sheets": "Fabrication, enclosures, doors, panels and general sheet metal work",
      "steel-pipes": "Scaffolding, railings, fencing, structural frames and general piping",
      "gi-steel": "Water supply lines, plumbing, outdoor fabrication and corrosion-prone areas",
      "ms-pipes": "Gates, grills, railings, frames and light fabrication",
      "binding-wire": "Tying TMT bars at laps and crossings in reinforcement work",
      "steel-mesh": "Slab and pavement reinforcement, plaster reinforcement and fencing",
      "stainless-steel": "Railings, kitchens, cladding, fittings and corrosion-resistant fabrication",
      "steel-flats": "Gates, grills, brackets, earthing strips and fabrication",
      "steel-rounds": "Shafts, anchors, fabrication and machining stock",
      "steel-squares": "Grills, gates, railings and ornamental fabrication",
      "steel-hollow-sections": "Structural frames, trusses, columns, canopies and facades",
      "roofing-steel": "Roofing and wall cladding for sheds, warehouses and buildings",
      "steel-fasteners": "Bolted connections in steel structures, fabrication and fixing"
    }$j$;

    steel_brands jsonb := $j$[
      {"slug": "tata-tiscon", "name": "Tata Tiscon", "manufacturer": "Tata Steel Limited", "description": "TMT reinforcement bars from Tata Steel.", "sort_order": 10},
      {"slug": "jsw-neosteel", "name": "JSW Neosteel", "manufacturer": "JSW Steel Limited", "description": "TMT reinforcement bars from JSW Steel.", "sort_order": 20},
      {"slug": "sail", "name": "SAIL", "manufacturer": "Steel Authority of India Limited", "description": "TMT bars, structurals and plates from Steel Authority of India.", "sort_order": 30},
      {"slug": "vizag-steel", "name": "Vizag Steel", "manufacturer": "Rashtriya Ispat Nigam Limited", "description": "TMT bars and long products from Rashtriya Ispat Nigam (Visakhapatnam Steel Plant).", "sort_order": 40},
      {"slug": "jindal-panther", "name": "Jindal Panther", "manufacturer": "Jindal Steel & Power Limited", "description": "TMT reinforcement bars from Jindal Steel & Power.", "sort_order": 50},
      {"slug": "kamdhenu", "name": "Kamdhenu", "manufacturer": "Kamdhenu Limited", "description": "TMT reinforcement bars.", "sort_order": 60},
      {"slug": "shyam-steel", "name": "Shyam Steel", "manufacturer": "Shyam Steel Industries Limited", "description": "TMT reinforcement bars.", "sort_order": 70},
      {"slug": "electrosteel", "name": "Electrosteel", "manufacturer": "ESL Steel Limited", "description": "TMT reinforcement bars.", "sort_order": 80},
      {"slug": "tata-structura", "name": "Tata Structura", "manufacturer": "Tata Steel Limited", "description": "Structural hollow sections from Tata Steel.", "sort_order": 90},
      {"slug": "apl-apollo", "name": "APL Apollo", "manufacturer": "APL Apollo Tubes Limited", "description": "Structural steel tubes and hollow sections.", "sort_order": 100},
      {"slug": "jindal-stainless", "name": "Jindal Stainless", "manufacturer": "Jindal Stainless Limited", "description": "Stainless steel sheets, plates, bars and pipes.", "sort_order": 110},
      {"slug": "tata-bluescope", "name": "Tata BlueScope", "manufacturer": "Tata BlueScope Steel Private Limited", "description": "Coated steel roofing and cladding sheets.", "sort_order": 120},
      {"slug": "generic-steel", "name": "Generic Steel", "manufacturer": null, "description": "Unbranded mild steel, galvanized steel and fastener products sold to standard specifications.", "sort_order": 900}
    ]$j$;

    steel_categories jsonb := $j$[
      {"slug": "steel", "name": "Steel", "description": "Reinforcement bars, structural steel, sections, plates, sheets, pipes, roofing and fasteners for construction.", "sort_order": 10, "subcategories": [{"slug": "tmt-bars", "name": "TMT Bars", "description": "Thermo-mechanically treated high strength deformed reinforcement bars (IS 1786:2008).", "sort_order": 10}, {"slug": "structural-steel", "name": "Structural Steel", "description": "Hot rolled mild steel for structural use (IS 2062:2011).", "sort_order": 20}, {"slug": "steel-sections", "name": "Steel Sections", "description": "Tee sections and cold formed purlins for light structural framing.", "sort_order": 30}, {"slug": "steel-angles", "name": "Steel Angles", "description": "Hot rolled equal angles (IS 808 / IS 2062).", "sort_order": 40}, {"slug": "steel-channels", "name": "Steel Channels", "description": "Hot rolled medium weight channels, ISMC (IS 808 / IS 2062).", "sort_order": 50}, {"slug": "steel-beams", "name": "Steel Beams", "description": "Hot rolled I and H beams, ISMB / ISHB (IS 808 / IS 2062).", "sort_order": 60}, {"slug": "steel-plates", "name": "Steel Plates", "description": "Hot rolled structural and chequered plates (IS 2062 / IS 3502).", "sort_order": 70}, {"slug": "steel-sheets", "name": "Steel Sheets", "description": "Hot rolled and cold rolled mild steel sheets.", "sort_order": 80}, {"slug": "steel-pipes", "name": "Steel Pipes", "description": "ERW and galvanized steel pipes for structural and general use.", "sort_order": 90}, {"slug": "gi-steel", "name": "GI Steel", "description": "Hot-dip galvanized steel pipes and plain sheets.", "sort_order": 100}, {"slug": "ms-pipes", "name": "MS Pipes", "description": "Mild steel square and rectangular pipes.", "sort_order": 110}, {"slug": "binding-wire", "name": "Binding Wire", "description": "Annealed mild steel wire for tying reinforcement bars.", "sort_order": 120}, {"slug": "steel-mesh", "name": "Steel Mesh", "description": "Welded wire mesh and reinforcement fabric.", "sort_order": 130}, {"slug": "stainless-steel", "name": "Stainless Steel", "description": "Austenitic stainless steel sheets, plates, bars and pipes (grade 304).", "sort_order": 140}, {"slug": "steel-flats", "name": "Steel Flats", "description": "Hot rolled mild steel flats (IS 2062).", "sort_order": 150}, {"slug": "steel-rounds", "name": "Steel Rounds", "description": "Hot rolled mild steel round bars (IS 2062).", "sort_order": 160}, {"slug": "steel-squares", "name": "Steel Squares", "description": "Hot rolled mild steel square bars (IS 2062).", "sort_order": 170}, {"slug": "steel-hollow-sections", "name": "Steel Hollow Sections", "description": "Structural circular, square and rectangular hollow sections (IS 4923 / IS 1161).", "sort_order": 180}, {"slug": "roofing-steel", "name": "Roofing Steel", "description": "Galvanized, GI corrugated and colour coated roofing sheets.", "sort_order": 190}, {"slug": "steel-fasteners", "name": "Steel Fasteners", "description": "Hexagon bolts, nuts and washers for structural connections.", "sort_order": 200}]}
    ]$j$;

    steel_products jsonb := $j$[
      {"slug": "tata-tiscon-fe-500-tmt-bar", "name": "Tata Tiscon Fe 500 TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "tata-tiscon", "unit": "Kg", "product_type": "Fe 500 TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500", "short_description": "Tata Tiscon Fe 500 grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "Tata Tiscon Fe 500 high strength deformed TMT bar conforming to IS 1786:2008. Suited to general RCC work in residential and commercial buildings. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "545 N/mm²", "Elongation (min)": "12%", "TS/YS Ratio (min)": "1.08", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "tata-tiscon-fe-500d-tmt-bar", "name": "Tata Tiscon Fe 500D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "tata-tiscon", "unit": "Kg", "product_type": "Fe 500D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500d", "short_description": "Tata Tiscon Fe 500D grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "Tata Tiscon Fe 500D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500D", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "565 N/mm²", "Elongation (min)": "16%", "TS/YS Ratio (min)": "1.10", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "tata-tiscon-fe-550-tmt-bar", "name": "Tata Tiscon Fe 550 TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "tata-tiscon", "unit": "Kg", "product_type": "Fe 550 TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe550", "short_description": "Tata Tiscon Fe 550 grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "Tata Tiscon Fe 550 high strength deformed TMT bar conforming to IS 1786:2008. Suited to general RCC work in residential and commercial buildings. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 550", "Yield Strength (min)": "550 N/mm²", "Tensile Strength (min)": "585 N/mm²", "Elongation (min)": "10%", "TS/YS Ratio (min)": "1.06", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "tata-tiscon-fe-550d-tmt-bar", "name": "Tata Tiscon Fe 550D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "tata-tiscon", "unit": "Kg", "product_type": "Fe 550D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe550d", "short_description": "Tata Tiscon Fe 550D grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "Tata Tiscon Fe 550D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 550D", "Yield Strength (min)": "550 N/mm²", "Tensile Strength (min)": "600 N/mm²", "Elongation (min)": "14.5%", "TS/YS Ratio (min)": "1.08", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "jsw-neosteel-fe-500-tmt-bar", "name": "JSW Neosteel Fe 500 TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "jsw-neosteel", "unit": "Kg", "product_type": "Fe 500 TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500", "short_description": "JSW Neosteel Fe 500 grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "JSW Neosteel Fe 500 high strength deformed TMT bar conforming to IS 1786:2008. Suited to general RCC work in residential and commercial buildings. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "545 N/mm²", "Elongation (min)": "12%", "TS/YS Ratio (min)": "1.08", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "jsw-neosteel-fe-500d-tmt-bar", "name": "JSW Neosteel Fe 500D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "jsw-neosteel", "unit": "Kg", "product_type": "Fe 500D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500d", "short_description": "JSW Neosteel Fe 500D grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "JSW Neosteel Fe 500D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500D", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "565 N/mm²", "Elongation (min)": "16%", "TS/YS Ratio (min)": "1.10", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "jsw-neosteel-fe-550-tmt-bar", "name": "JSW Neosteel Fe 550 TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "jsw-neosteel", "unit": "Kg", "product_type": "Fe 550 TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe550", "short_description": "JSW Neosteel Fe 550 grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "JSW Neosteel Fe 550 high strength deformed TMT bar conforming to IS 1786:2008. Suited to general RCC work in residential and commercial buildings. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 550", "Yield Strength (min)": "550 N/mm²", "Tensile Strength (min)": "585 N/mm²", "Elongation (min)": "10%", "TS/YS Ratio (min)": "1.06", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "jsw-neosteel-fe-550d-tmt-bar", "name": "JSW Neosteel Fe 550D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "jsw-neosteel", "unit": "Kg", "product_type": "Fe 550D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe550d", "short_description": "JSW Neosteel Fe 550D grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "JSW Neosteel Fe 550D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 550D", "Yield Strength (min)": "550 N/mm²", "Tensile Strength (min)": "600 N/mm²", "Elongation (min)": "14.5%", "TS/YS Ratio (min)": "1.08", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "sail-fe-500-tmt-bar", "name": "SAIL Fe 500 TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "sail", "unit": "Kg", "product_type": "Fe 500 TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500", "short_description": "SAIL Fe 500 grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "SAIL Fe 500 high strength deformed TMT bar conforming to IS 1786:2008. Suited to general RCC work in residential and commercial buildings. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "545 N/mm²", "Elongation (min)": "12%", "TS/YS Ratio (min)": "1.08", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "sail-fe-500d-tmt-bar", "name": "SAIL Fe 500D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "sail", "unit": "Kg", "product_type": "Fe 500D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500d", "short_description": "SAIL Fe 500D grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "SAIL Fe 500D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500D", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "565 N/mm²", "Elongation (min)": "16%", "TS/YS Ratio (min)": "1.10", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "vizag-steel-fe-500-tmt-bar", "name": "Vizag Steel Fe 500 TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "vizag-steel", "unit": "Kg", "product_type": "Fe 500 TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500", "short_description": "Vizag Steel Fe 500 grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "Vizag Steel Fe 500 high strength deformed TMT bar conforming to IS 1786:2008. Suited to general RCC work in residential and commercial buildings. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "545 N/mm²", "Elongation (min)": "12%", "TS/YS Ratio (min)": "1.08", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "vizag-steel-fe-500d-tmt-bar", "name": "Vizag Steel Fe 500D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "vizag-steel", "unit": "Kg", "product_type": "Fe 500D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500d", "short_description": "Vizag Steel Fe 500D grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "Vizag Steel Fe 500D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500D", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "565 N/mm²", "Elongation (min)": "16%", "TS/YS Ratio (min)": "1.10", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "jindal-panther-fe-500d-tmt-bar", "name": "Jindal Panther Fe 500D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "jindal-panther", "unit": "Kg", "product_type": "Fe 500D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500d", "short_description": "Jindal Panther Fe 500D grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "Jindal Panther Fe 500D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500D", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "565 N/mm²", "Elongation (min)": "16%", "TS/YS Ratio (min)": "1.10", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "jindal-panther-fe-550d-tmt-bar", "name": "Jindal Panther Fe 550D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "jindal-panther", "unit": "Kg", "product_type": "Fe 550D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe550d", "short_description": "Jindal Panther Fe 550D grade TMT reinforcement bar, 8 mm to 40 mm, in 12 m lengths.", "description": "Jindal Panther Fe 550D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 550D", "Yield Strength (min)": "550 N/mm²", "Tensile Strength (min)": "600 N/mm²", "Elongation (min)": "14.5%", "TS/YS Ratio (min)": "1.08", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}, {"slug": "36-mm", "name": "36 mm", "specifications": {"Diameter": "36 mm", "Nominal Mass": "7.99 kg/m", "Length": "12 m"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm", "Nominal Mass": "9.86 kg/m", "Length": "12 m"}}]},
      {"slug": "kamdhenu-fe-500d-tmt-bar", "name": "Kamdhenu Fe 500D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "kamdhenu", "unit": "Kg", "product_type": "Fe 500D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500d", "short_description": "Kamdhenu Fe 500D grade TMT reinforcement bar, 8 mm to 32 mm, in 12 m lengths.", "description": "Kamdhenu Fe 500D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500D", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "565 N/mm²", "Elongation (min)": "16%", "TS/YS Ratio (min)": "1.10", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}]},
      {"slug": "shyam-steel-fe-500d-tmt-bar", "name": "Shyam Steel Fe 500D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "shyam-steel", "unit": "Kg", "product_type": "Fe 500D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500d", "short_description": "Shyam Steel Fe 500D grade TMT reinforcement bar, 8 mm to 32 mm, in 12 m lengths.", "description": "Shyam Steel Fe 500D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500D", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "565 N/mm²", "Elongation (min)": "16%", "TS/YS Ratio (min)": "1.10", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}]},
      {"slug": "electrosteel-fe-500d-tmt-bar", "name": "Electrosteel Fe 500D TMT Bar", "category": "steel", "subcategory": "tmt-bars", "brand": "electrosteel", "unit": "Kg", "product_type": "Fe 500D TMT Bar", "standard": "IS 1786:2008", "keywords": "tmt rebar saria sariya reinforcement bar fe500d", "short_description": "Electrosteel Fe 500D grade TMT reinforcement bar, 8 mm to 32 mm, in 12 m lengths.", "description": "Electrosteel Fe 500D high strength deformed TMT bar conforming to IS 1786:2008. The D grade adds higher elongation and a higher tensile-to-yield ratio for better ductility, preferred for earthquake-prone zones. Supplied in standard 12 m lengths and priced by weight.", "specifications": {"Grade": "Fe 500D", "Yield Strength (min)": "500 N/mm²", "Tensile Strength (min)": "565 N/mm²", "Elongation (min)": "16%", "TS/YS Ratio (min)": "1.10", "Process": "Thermo-Mechanical Treatment (TMT)", "Standard Length": "12 m"}, "variants": [{"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm", "Nominal Mass": "0.395 kg/m", "Length": "12 m"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm", "Nominal Mass": "0.617 kg/m", "Length": "12 m"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm", "Nominal Mass": "0.888 kg/m", "Length": "12 m"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm", "Nominal Mass": "1.58 kg/m", "Length": "12 m"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm", "Nominal Mass": "2.47 kg/m", "Length": "12 m"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm", "Nominal Mass": "3.85 kg/m", "Length": "12 m"}}, {"slug": "28-mm", "name": "28 mm", "specifications": {"Diameter": "28 mm", "Nominal Mass": "4.83 kg/m", "Length": "12 m"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm", "Nominal Mass": "6.31 kg/m", "Length": "12 m"}}]},
      {"slug": "is-2062-structural-steel", "name": "IS 2062 Structural Steel", "category": "steel", "subcategory": "structural-steel", "brand": "sail", "unit": "Tonne", "product_type": "Hot Rolled Structural Steel", "standard": "IS 2062:2011", "keywords": "ms structural steel e250 e350 e410", "short_description": "Hot rolled structural steel to IS 2062, supplied by grade.", "description": "Hot rolled structural steel conforming to IS 2062:2011, the standard for steel used in buildings, bridges and general structural fabrication. Grade E250 is the common mild steel grade; E350 and E410 give higher strength.", "specifications": {"Material": "Hot rolled carbon steel", "Weldability": "Weldable"}, "variants": [{"slug": "e250-a", "name": "E250 A", "specifications": {"Grade": "E250 A", "Yield Strength (min)": "250 N/mm²"}}, {"slug": "e250-br", "name": "E250 BR", "specifications": {"Grade": "E250 BR", "Yield Strength (min)": "250 N/mm²", "Impact Tested": "At room temperature"}}, {"slug": "e350-br", "name": "E350 BR", "specifications": {"Grade": "E350 BR", "Yield Strength (min)": "350 N/mm²", "Impact Tested": "At room temperature"}}, {"slug": "e410-br", "name": "E410 BR", "specifications": {"Grade": "E410 BR", "Yield Strength (min)": "410 N/mm²", "Impact Tested": "At room temperature"}}]},
      {"slug": "ms-structural-steel", "name": "MS Structural Steel", "category": "steel", "subcategory": "structural-steel", "brand": "generic-steel", "unit": "Kg", "product_type": "Mild Steel Structural Section", "standard": "IS 2062:2011", "keywords": "ms mild steel structure fabrication", "short_description": "Mild steel structural steel for general fabrication, grade E250.", "description": "General purpose mild steel structural steel of grade E250 to IS 2062, used for sheds, frames, platforms and light structural fabrication. Supplied by weight.", "specifications": {"Grade": "E250", "Yield Strength (min)": "250 N/mm²", "Material": "Mild steel"}, "variants": []},
      {"slug": "ms-tee-section", "name": "MS Tee Section", "category": "steel", "subcategory": "steel-sections", "brand": "generic-steel", "unit": "Kg", "product_type": "Hot Rolled Tee Section", "standard": "IS 808 / IS 2062:2011", "keywords": "t section tee ms", "short_description": "Hot rolled mild steel tee sections for framing and fabrication.", "description": "Mild steel tee (T) sections in grade E250, used for frames, supports, glazing bars and fabrication.", "specifications": {"Grade": "E250", "Material": "Mild steel", "Length": "6 m"}, "variants": [{"slug": "40-x-40-x-6-mm", "name": "40 x 40 x 6 mm", "specifications": {"Size": "40 x 40 x 6 mm"}}, {"slug": "50-x-50-x-6-mm", "name": "50 x 50 x 6 mm", "specifications": {"Size": "50 x 50 x 6 mm"}}, {"slug": "60-x-60-x-6-mm", "name": "60 x 60 x 6 mm", "specifications": {"Size": "60 x 60 x 6 mm"}}, {"slug": "75-x-75-x-8-mm", "name": "75 x 75 x 8 mm", "specifications": {"Size": "75 x 75 x 8 mm"}}]},
      {"slug": "cold-formed-c-purlin", "name": "Cold Formed C Purlin", "category": "steel", "subcategory": "steel-sections", "brand": "generic-steel", "unit": "Kg", "product_type": "Cold Formed Lipped Channel", "standard": "IS 811", "keywords": "purlin c section z purlin girt", "short_description": "Cold formed lipped C purlins for roof and wall framing.", "description": "Cold formed light gauge lipped channel (C) purlins to IS 811, used as roof purlins and wall girts in pre-engineered and conventional steel buildings.", "specifications": {"Material": "Galvanized / mild steel strip", "Profile": "Lipped C"}, "variants": [{"slug": "100-x-50-x-20-mm-x-2-mm", "name": "100 x 50 x 20 mm x 2 mm", "specifications": {"Size": "100 x 50 x 20 mm", "Thickness": "2 mm"}}, {"slug": "150-x-65-x-20-mm-x-2-mm", "name": "150 x 65 x 20 mm x 2 mm", "specifications": {"Size": "150 x 65 x 20 mm", "Thickness": "2 mm"}}, {"slug": "200-x-75-x-20-mm-x-2-mm", "name": "200 x 75 x 20 mm x 2 mm", "specifications": {"Size": "200 x 75 x 20 mm", "Thickness": "2 mm"}}]},
      {"slug": "ms-angle", "name": "MS Angle", "category": "steel", "subcategory": "steel-angles", "brand": "generic-steel", "unit": "Kg", "product_type": "Hot Rolled Equal Angle", "standard": "IS 808 / IS 2062:2011", "keywords": "angle l section ms angle", "short_description": "Hot rolled mild steel equal angles, grade E250.", "description": "Mild steel equal angles (L sections) in grade E250, used in trusses, frames, bracing, supports and general fabrication. Supplied in 6 m lengths and priced by weight.", "specifications": {"Grade": "E250", "Material": "Mild steel", "Length": "6 m"}, "variants": [{"slug": "25-x-25-x-3-mm", "name": "25 x 25 x 3 mm", "specifications": {"Size": "25 x 25 x 3 mm"}}, {"slug": "35-x-35-x-5-mm", "name": "35 x 35 x 5 mm", "specifications": {"Size": "35 x 35 x 5 mm"}}, {"slug": "40-x-40-x-5-mm", "name": "40 x 40 x 5 mm", "specifications": {"Size": "40 x 40 x 5 mm"}}, {"slug": "50-x-50-x-5-mm", "name": "50 x 50 x 5 mm", "specifications": {"Size": "50 x 50 x 5 mm"}}, {"slug": "50-x-50-x-6-mm", "name": "50 x 50 x 6 mm", "specifications": {"Size": "50 x 50 x 6 mm"}}, {"slug": "65-x-65-x-6-mm", "name": "65 x 65 x 6 mm", "specifications": {"Size": "65 x 65 x 6 mm"}}, {"slug": "75-x-75-x-6-mm", "name": "75 x 75 x 6 mm", "specifications": {"Size": "75 x 75 x 6 mm"}}, {"slug": "75-x-75-x-8-mm", "name": "75 x 75 x 8 mm", "specifications": {"Size": "75 x 75 x 8 mm"}}, {"slug": "90-x-90-x-8-mm", "name": "90 x 90 x 8 mm", "specifications": {"Size": "90 x 90 x 8 mm"}}, {"slug": "100-x-100-x-10-mm", "name": "100 x 100 x 10 mm", "specifications": {"Size": "100 x 100 x 10 mm"}}]},
      {"slug": "ms-channel", "name": "MS Channel", "category": "steel", "subcategory": "steel-channels", "brand": "generic-steel", "unit": "Kg", "product_type": "Hot Rolled Channel (ISMC)", "standard": "IS 808 / IS 2062:2011", "keywords": "channel c channel ismc", "short_description": "Hot rolled mild steel medium weight channels (ISMC), grade E250.", "description": "Indian Standard medium weight channels (ISMC) in grade E250, used for purlins, frames, columns and structural fabrication. Supplied by weight.", "specifications": {"Grade": "E250", "Material": "Mild steel", "Designation": "ISMC"}, "variants": [{"slug": "ismc-75", "name": "ISMC 75", "specifications": {"Designation": "ISMC 75", "Depth": "75 mm"}}, {"slug": "ismc-100", "name": "ISMC 100", "specifications": {"Designation": "ISMC 100", "Depth": "100 mm"}}, {"slug": "ismc-125", "name": "ISMC 125", "specifications": {"Designation": "ISMC 125", "Depth": "125 mm"}}, {"slug": "ismc-150", "name": "ISMC 150", "specifications": {"Designation": "ISMC 150", "Depth": "150 mm"}}, {"slug": "ismc-200", "name": "ISMC 200", "specifications": {"Designation": "ISMC 200", "Depth": "200 mm"}}, {"slug": "ismc-250", "name": "ISMC 250", "specifications": {"Designation": "ISMC 250", "Depth": "250 mm"}}, {"slug": "ismc-300", "name": "ISMC 300", "specifications": {"Designation": "ISMC 300", "Depth": "300 mm"}}]},
      {"slug": "ms-i-beam", "name": "MS I Beam", "category": "steel", "subcategory": "steel-beams", "brand": "sail", "unit": "Kg", "product_type": "Hot Rolled I Beam (ISMB)", "standard": "IS 808 / IS 2062:2011", "keywords": "i beam joist girder ismb", "short_description": "Hot rolled medium weight I beams (ISMB), grade E250.", "description": "Indian Standard medium weight beams (ISMB) in grade E250 for beams, girders and floor framing in steel structures.", "specifications": {"Grade": "E250", "Material": "Mild steel", "Designation": "ISMB"}, "variants": [{"slug": "ismb-100", "name": "ISMB 100", "specifications": {"Designation": "ISMB 100", "Depth": "100 mm"}}, {"slug": "ismb-150", "name": "ISMB 150", "specifications": {"Designation": "ISMB 150", "Depth": "150 mm"}}, {"slug": "ismb-200", "name": "ISMB 200", "specifications": {"Designation": "ISMB 200", "Depth": "200 mm"}}, {"slug": "ismb-250", "name": "ISMB 250", "specifications": {"Designation": "ISMB 250", "Depth": "250 mm"}}, {"slug": "ismb-300", "name": "ISMB 300", "specifications": {"Designation": "ISMB 300", "Depth": "300 mm"}}, {"slug": "ismb-400", "name": "ISMB 400", "specifications": {"Designation": "ISMB 400", "Depth": "400 mm"}}]},
      {"slug": "ms-h-beam", "name": "MS H Beam", "category": "steel", "subcategory": "steel-beams", "brand": "sail", "unit": "Kg", "product_type": "Hot Rolled H Beam (ISHB)", "standard": "IS 808 / IS 2062:2011", "keywords": "h beam column wide flange ishb", "short_description": "Hot rolled H beams (ISHB) for columns and heavy framing, grade E250.", "description": "Indian Standard heavy weight beams (ISHB) with wide flanges, used mainly as columns and in heavy structural framing. Grade E250.", "specifications": {"Grade": "E250", "Material": "Mild steel", "Designation": "ISHB"}, "variants": [{"slug": "ishb-150", "name": "ISHB 150", "specifications": {"Designation": "ISHB 150", "Depth": "150 mm"}}, {"slug": "ishb-200", "name": "ISHB 200", "specifications": {"Designation": "ISHB 200", "Depth": "200 mm"}}, {"slug": "ishb-250", "name": "ISHB 250", "specifications": {"Designation": "ISHB 250", "Depth": "250 mm"}}, {"slug": "ishb-300", "name": "ISHB 300", "specifications": {"Designation": "ISHB 300", "Depth": "300 mm"}}, {"slug": "ishb-350", "name": "ISHB 350", "specifications": {"Designation": "ISHB 350", "Depth": "350 mm"}}, {"slug": "ishb-400", "name": "ISHB 400", "specifications": {"Designation": "ISHB 400", "Depth": "400 mm"}}, {"slug": "ishb-450", "name": "ISHB 450", "specifications": {"Designation": "ISHB 450", "Depth": "450 mm"}}]},
      {"slug": "structural-steel-plate", "name": "Structural Steel Plate", "category": "steel", "subcategory": "steel-plates", "brand": "sail", "unit": "Kg", "product_type": "Hot Rolled Plate", "standard": "IS 2062:2011", "keywords": "ms plate hr plate base plate", "short_description": "Hot rolled structural steel plates, grade E250, by thickness.", "description": "Hot rolled structural steel plates to IS 2062 grade E250, used for base plates, gussets, brackets and heavy fabrication. Priced by weight.", "specifications": {"Grade": "E250", "Material": "Hot rolled carbon steel"}, "variants": [{"slug": "5-mm", "name": "5 mm", "specifications": {"Thickness": "5 mm"}}, {"slug": "6-mm", "name": "6 mm", "specifications": {"Thickness": "6 mm"}}, {"slug": "8-mm", "name": "8 mm", "specifications": {"Thickness": "8 mm"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Thickness": "10 mm"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Thickness": "12 mm"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Thickness": "16 mm"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Thickness": "20 mm"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Thickness": "25 mm"}}]},
      {"slug": "ms-chequered-plate", "name": "MS Chequered Plate", "category": "steel", "subcategory": "steel-plates", "brand": "generic-steel", "unit": "Kg", "product_type": "Chequered Plate", "standard": "IS 3502", "keywords": "chequered checker plate flooring", "short_description": "Mild steel chequered plates for anti-slip flooring.", "description": "Hot rolled mild steel chequered plates to IS 3502 with a raised pattern for slip resistance, used for platforms, stair treads, ramps and trench covers.", "specifications": {"Material": "Mild steel", "Surface": "Raised chequer pattern"}, "variants": [{"slug": "5-mm", "name": "5 mm", "specifications": {"Thickness": "5 mm"}}, {"slug": "6-mm", "name": "6 mm", "specifications": {"Thickness": "6 mm"}}, {"slug": "8-mm", "name": "8 mm", "specifications": {"Thickness": "8 mm"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Thickness": "10 mm"}}]},
      {"slug": "ms-hot-rolled-sheet", "name": "MS Hot Rolled Sheet", "category": "steel", "subcategory": "steel-sheets", "brand": "generic-steel", "unit": "Kg", "product_type": "Hot Rolled Sheet", "standard": "IS 2062:2011", "keywords": "hr sheet ms sheet", "short_description": "Hot rolled mild steel sheets, 2 mm to 4 mm.", "description": "Hot rolled mild steel sheets for fabrication, enclosures, tanks and general sheet metal work. Priced by weight.", "specifications": {"Material": "Hot rolled mild steel"}, "variants": [{"slug": "2-mm", "name": "2 mm", "specifications": {"Thickness": "2 mm"}}, {"slug": "2-5-mm", "name": "2.5 mm", "specifications": {"Thickness": "2.5 mm"}}, {"slug": "3-mm", "name": "3 mm", "specifications": {"Thickness": "3 mm"}}, {"slug": "4-mm", "name": "4 mm", "specifications": {"Thickness": "4 mm"}}]},
      {"slug": "ms-cold-rolled-sheet", "name": "MS Cold Rolled Sheet", "category": "steel", "subcategory": "steel-sheets", "brand": "generic-steel", "unit": "Kg", "product_type": "Cold Rolled Sheet", "standard": "IS 513", "keywords": "cr sheet crca sheet", "short_description": "Cold rolled mild steel sheets with a smooth finish, 0.8 mm to 1.6 mm.", "description": "Cold rolled close annealed mild steel sheets to IS 513 with a smooth surface, used for doors, panels, cabinets and fabrication that is painted or powder coated.", "specifications": {"Material": "Cold rolled mild steel", "Finish": "Smooth"}, "variants": [{"slug": "0-8-mm", "name": "0.8 mm", "specifications": {"Thickness": "0.8 mm"}}, {"slug": "1-0-mm", "name": "1.0 mm", "specifications": {"Thickness": "1.0 mm"}}, {"slug": "1-2-mm", "name": "1.2 mm", "specifications": {"Thickness": "1.2 mm"}}, {"slug": "1-6-mm", "name": "1.6 mm", "specifications": {"Thickness": "1.6 mm"}}]},
      {"slug": "ms-round-pipe", "name": "MS Round Pipe", "category": "steel", "subcategory": "steel-pipes", "brand": "generic-steel", "unit": "Piece", "product_type": "ERW Black Steel Pipe (Medium)", "standard": "IS 1239 (Part 1)", "keywords": "ms pipe erw pipe black pipe round pipe", "short_description": "ERW mild steel round pipes, medium class, 15 mm to 100 mm NB, 6 m long.", "description": "Electric resistance welded black mild steel pipes to IS 1239 (Part 1), medium class, for scaffolding, railings, structural frames and general piping. Sold per 6 m length.", "specifications": {"Class": "Medium", "Material": "Mild steel", "Finish": "Black (uncoated)", "Ends": "Plain"}, "variants": [{"slug": "15-mm-nb", "name": "15 mm NB", "specifications": {"Nominal Bore": "15 mm", "Outside Diameter": "21.3 mm", "Wall Thickness": "2.6 mm", "Length": "6 m"}}, {"slug": "20-mm-nb", "name": "20 mm NB", "specifications": {"Nominal Bore": "20 mm", "Outside Diameter": "26.9 mm", "Wall Thickness": "2.6 mm", "Length": "6 m"}}, {"slug": "25-mm-nb", "name": "25 mm NB", "specifications": {"Nominal Bore": "25 mm", "Outside Diameter": "33.7 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "32-mm-nb", "name": "32 mm NB", "specifications": {"Nominal Bore": "32 mm", "Outside Diameter": "42.4 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "40-mm-nb", "name": "40 mm NB", "specifications": {"Nominal Bore": "40 mm", "Outside Diameter": "48.3 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "50-mm-nb", "name": "50 mm NB", "specifications": {"Nominal Bore": "50 mm", "Outside Diameter": "60.3 mm", "Wall Thickness": "3.6 mm", "Length": "6 m"}}, {"slug": "65-mm-nb", "name": "65 mm NB", "specifications": {"Nominal Bore": "65 mm", "Outside Diameter": "76.1 mm", "Wall Thickness": "3.6 mm", "Length": "6 m"}}, {"slug": "80-mm-nb", "name": "80 mm NB", "specifications": {"Nominal Bore": "80 mm", "Outside Diameter": "88.9 mm", "Wall Thickness": "4.0 mm", "Length": "6 m"}}, {"slug": "100-mm-nb", "name": "100 mm NB", "specifications": {"Nominal Bore": "100 mm", "Outside Diameter": "114.3 mm", "Wall Thickness": "4.5 mm", "Length": "6 m"}}]},
      {"slug": "galvanized-structural-pipe", "name": "Galvanized Structural Pipe", "category": "steel", "subcategory": "steel-pipes", "brand": "apl-apollo", "unit": "Piece", "product_type": "Pre-Galvanized Structural Tube", "standard": "IS 1161", "keywords": "gi structural tube galvanised pipe", "short_description": "Galvanized steel tubes for structural use, 15 mm to 100 mm NB.", "description": "Galvanized circular steel tubes for structural purposes to IS 1161, used for scaffolding, fencing, solar structures, greenhouses and canopies. Sold per 6 m length.", "specifications": {"Class": "Medium", "Coating": "Zinc galvanized", "Material": "Steel"}, "variants": [{"slug": "15-mm-nb", "name": "15 mm NB", "specifications": {"Nominal Bore": "15 mm", "Outside Diameter": "21.3 mm", "Wall Thickness": "2.6 mm", "Length": "6 m"}}, {"slug": "20-mm-nb", "name": "20 mm NB", "specifications": {"Nominal Bore": "20 mm", "Outside Diameter": "26.9 mm", "Wall Thickness": "2.6 mm", "Length": "6 m"}}, {"slug": "25-mm-nb", "name": "25 mm NB", "specifications": {"Nominal Bore": "25 mm", "Outside Diameter": "33.7 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "32-mm-nb", "name": "32 mm NB", "specifications": {"Nominal Bore": "32 mm", "Outside Diameter": "42.4 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "40-mm-nb", "name": "40 mm NB", "specifications": {"Nominal Bore": "40 mm", "Outside Diameter": "48.3 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "50-mm-nb", "name": "50 mm NB", "specifications": {"Nominal Bore": "50 mm", "Outside Diameter": "60.3 mm", "Wall Thickness": "3.6 mm", "Length": "6 m"}}, {"slug": "65-mm-nb", "name": "65 mm NB", "specifications": {"Nominal Bore": "65 mm", "Outside Diameter": "76.1 mm", "Wall Thickness": "3.6 mm", "Length": "6 m"}}, {"slug": "80-mm-nb", "name": "80 mm NB", "specifications": {"Nominal Bore": "80 mm", "Outside Diameter": "88.9 mm", "Wall Thickness": "4.0 mm", "Length": "6 m"}}, {"slug": "100-mm-nb", "name": "100 mm NB", "specifications": {"Nominal Bore": "100 mm", "Outside Diameter": "114.3 mm", "Wall Thickness": "4.5 mm", "Length": "6 m"}}]},
      {"slug": "gi-pipe", "name": "GI Pipe", "category": "steel", "subcategory": "gi-steel", "brand": "generic-steel", "unit": "Piece", "product_type": "GI Pipe (Medium Class)", "standard": "IS 1239 (Part 1)", "keywords": "gi pipe galvanised pipe water pipe", "short_description": "Hot-dip galvanized steel pipes, medium class, for water lines.", "description": "Hot-dip galvanized ERW steel pipes to IS 1239 (Part 1), medium class, for water supply, plumbing and general piping. Sold per 6 m length.", "specifications": {"Class": "Medium", "Coating": "Hot-dip galvanized", "Ends": "Screwed and socketed / plain"}, "variants": [{"slug": "15-mm-nb", "name": "15 mm NB", "specifications": {"Nominal Bore": "15 mm", "Outside Diameter": "21.3 mm", "Wall Thickness": "2.6 mm", "Length": "6 m"}}, {"slug": "20-mm-nb", "name": "20 mm NB", "specifications": {"Nominal Bore": "20 mm", "Outside Diameter": "26.9 mm", "Wall Thickness": "2.6 mm", "Length": "6 m"}}, {"slug": "25-mm-nb", "name": "25 mm NB", "specifications": {"Nominal Bore": "25 mm", "Outside Diameter": "33.7 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "32-mm-nb", "name": "32 mm NB", "specifications": {"Nominal Bore": "32 mm", "Outside Diameter": "42.4 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "40-mm-nb", "name": "40 mm NB", "specifications": {"Nominal Bore": "40 mm", "Outside Diameter": "48.3 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "50-mm-nb", "name": "50 mm NB", "specifications": {"Nominal Bore": "50 mm", "Outside Diameter": "60.3 mm", "Wall Thickness": "3.6 mm", "Length": "6 m"}}, {"slug": "65-mm-nb", "name": "65 mm NB", "specifications": {"Nominal Bore": "65 mm", "Outside Diameter": "76.1 mm", "Wall Thickness": "3.6 mm", "Length": "6 m"}}, {"slug": "80-mm-nb", "name": "80 mm NB", "specifications": {"Nominal Bore": "80 mm", "Outside Diameter": "88.9 mm", "Wall Thickness": "4.0 mm", "Length": "6 m"}}, {"slug": "100-mm-nb", "name": "100 mm NB", "specifications": {"Nominal Bore": "100 mm", "Outside Diameter": "114.3 mm", "Wall Thickness": "4.5 mm", "Length": "6 m"}}]},
      {"slug": "gi-steel-pipe", "name": "GI Steel Pipe", "category": "steel", "subcategory": "gi-steel", "brand": "generic-steel", "unit": "Piece", "product_type": "GI Pipe (Heavy Class)", "standard": "IS 1239 (Part 1)", "keywords": "gi pipe heavy class galvanised", "short_description": "Hot-dip galvanized steel pipes, heavy class, for high-pressure and heavy-duty lines.", "description": "Hot-dip galvanized ERW steel pipes to IS 1239 (Part 1), heavy class, with thicker walls for pumping lines, fire lines and heavy-duty piping. Sold per 6 m length.", "specifications": {"Class": "Heavy", "Coating": "Hot-dip galvanized", "Ends": "Screwed and socketed / plain"}, "variants": [{"slug": "15-mm-nb", "name": "15 mm NB", "specifications": {"Nominal Bore": "15 mm", "Outside Diameter": "21.3 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "20-mm-nb", "name": "20 mm NB", "specifications": {"Nominal Bore": "20 mm", "Outside Diameter": "26.9 mm", "Wall Thickness": "3.2 mm", "Length": "6 m"}}, {"slug": "25-mm-nb", "name": "25 mm NB", "specifications": {"Nominal Bore": "25 mm", "Outside Diameter": "33.7 mm", "Wall Thickness": "4.0 mm", "Length": "6 m"}}, {"slug": "32-mm-nb", "name": "32 mm NB", "specifications": {"Nominal Bore": "32 mm", "Outside Diameter": "42.4 mm", "Wall Thickness": "4.0 mm", "Length": "6 m"}}, {"slug": "40-mm-nb", "name": "40 mm NB", "specifications": {"Nominal Bore": "40 mm", "Outside Diameter": "48.3 mm", "Wall Thickness": "4.0 mm", "Length": "6 m"}}, {"slug": "50-mm-nb", "name": "50 mm NB", "specifications": {"Nominal Bore": "50 mm", "Outside Diameter": "60.3 mm", "Wall Thickness": "4.5 mm", "Length": "6 m"}}, {"slug": "65-mm-nb", "name": "65 mm NB", "specifications": {"Nominal Bore": "65 mm", "Outside Diameter": "76.1 mm", "Wall Thickness": "4.5 mm", "Length": "6 m"}}, {"slug": "80-mm-nb", "name": "80 mm NB", "specifications": {"Nominal Bore": "80 mm", "Outside Diameter": "88.9 mm", "Wall Thickness": "4.8 mm", "Length": "6 m"}}, {"slug": "100-mm-nb", "name": "100 mm NB", "specifications": {"Nominal Bore": "100 mm", "Outside Diameter": "114.3 mm", "Wall Thickness": "5.4 mm", "Length": "6 m"}}]},
      {"slug": "gi-plain-sheet", "name": "GI Plain Sheet", "category": "steel", "subcategory": "gi-steel", "brand": "generic-steel", "unit": "Kg", "product_type": "Galvanized Plain Sheet", "standard": "IS 277", "keywords": "gp sheet gi sheet galvanised sheet", "short_description": "Galvanized plain (GP) steel sheets, 0.5 mm to 1.2 mm.", "description": "Hot-dip galvanized plain steel sheets to IS 277 for ducting, flashing, enclosures and fabrication where corrosion resistance is needed.", "specifications": {"Coating": "Zinc galvanized", "Surface": "Plain"}, "variants": [{"slug": "0-5-mm", "name": "0.5 mm", "specifications": {"Thickness": "0.5 mm"}}, {"slug": "0-8-mm", "name": "0.8 mm", "specifications": {"Thickness": "0.8 mm"}}, {"slug": "1-0-mm", "name": "1.0 mm", "specifications": {"Thickness": "1.0 mm"}}, {"slug": "1-2-mm", "name": "1.2 mm", "specifications": {"Thickness": "1.2 mm"}}]},
      {"slug": "ms-square-pipe", "name": "MS Square Pipe", "category": "steel", "subcategory": "ms-pipes", "brand": "generic-steel", "unit": "Kg", "product_type": "MS Square Pipe", "standard": "IS 4923", "keywords": "square pipe square tube ms", "short_description": "Mild steel square pipes for gates, grills and frames.", "description": "ERW mild steel square pipes for gates, grills, railings, furniture frames and light fabrication. Supplied in 6 m lengths and priced by weight.", "specifications": {"Material": "Mild steel", "Length": "6 m"}, "variants": [{"slug": "20-x-20-mm", "name": "20 x 20 mm", "specifications": {"Size": "20 x 20 mm"}}, {"slug": "25-x-25-mm", "name": "25 x 25 mm", "specifications": {"Size": "25 x 25 mm"}}, {"slug": "40-x-40-mm", "name": "40 x 40 mm", "specifications": {"Size": "40 x 40 mm"}}, {"slug": "50-x-50-mm", "name": "50 x 50 mm", "specifications": {"Size": "50 x 50 mm"}}, {"slug": "72-x-72-mm", "name": "72 x 72 mm", "specifications": {"Size": "72 x 72 mm"}}, {"slug": "100-x-100-mm", "name": "100 x 100 mm", "specifications": {"Size": "100 x 100 mm"}}]},
      {"slug": "ms-rectangular-pipe", "name": "MS Rectangular Pipe", "category": "steel", "subcategory": "ms-pipes", "brand": "generic-steel", "unit": "Kg", "product_type": "MS Rectangular Pipe", "standard": "IS 4923", "keywords": "rectangular pipe rectangle tube ms", "short_description": "Mild steel rectangular pipes for frames and fabrication.", "description": "ERW mild steel rectangular pipes for gates, frames, sheds and fabrication. Supplied in 6 m lengths and priced by weight.", "specifications": {"Material": "Mild steel", "Length": "6 m"}, "variants": [{"slug": "40-x-20-mm", "name": "40 x 20 mm", "specifications": {"Size": "40 x 20 mm"}}, {"slug": "50-x-25-mm", "name": "50 x 25 mm", "specifications": {"Size": "50 x 25 mm"}}, {"slug": "60-x-40-mm", "name": "60 x 40 mm", "specifications": {"Size": "60 x 40 mm"}}, {"slug": "80-x-40-mm", "name": "80 x 40 mm", "specifications": {"Size": "80 x 40 mm"}}, {"slug": "100-x-50-mm", "name": "100 x 50 mm", "specifications": {"Size": "100 x 50 mm"}}, {"slug": "120-x-60-mm", "name": "120 x 60 mm", "specifications": {"Size": "120 x 60 mm"}}]},
      {"slug": "ms-hollow-section", "name": "MS Hollow Section", "category": "steel", "subcategory": "steel-hollow-sections", "brand": "tata-structura", "unit": "Kg", "product_type": "Circular Hollow Section (CHS)", "standard": "IS 1161", "keywords": "chs hollow section round tube structural", "short_description": "Structural circular hollow sections for columns, trusses and canopies.", "description": "Circular hollow sections (CHS) for structural use to IS 1161, used in trusses, columns, canopies and space frames. Priced by weight.", "specifications": {"Profile": "Circular", "Material": "Structural steel", "Length": "6 m"}, "variants": [{"slug": "33-7-mm-od", "name": "33.7 mm OD", "specifications": {"Outside Diameter": "33.7 mm"}}, {"slug": "42-4-mm-od", "name": "42.4 mm OD", "specifications": {"Outside Diameter": "42.4 mm"}}, {"slug": "48-3-mm-od", "name": "48.3 mm OD", "specifications": {"Outside Diameter": "48.3 mm"}}, {"slug": "60-3-mm-od", "name": "60.3 mm OD", "specifications": {"Outside Diameter": "60.3 mm"}}, {"slug": "76-1-mm-od", "name": "76.1 mm OD", "specifications": {"Outside Diameter": "76.1 mm"}}, {"slug": "88-9-mm-od", "name": "88.9 mm OD", "specifications": {"Outside Diameter": "88.9 mm"}}]},
      {"slug": "ms-square-hollow-section", "name": "MS Square Hollow Section", "category": "steel", "subcategory": "steel-hollow-sections", "brand": "apl-apollo", "unit": "Kg", "product_type": "Square Hollow Section (SHS)", "standard": "IS 4923", "keywords": "shs square hollow section", "short_description": "Structural square hollow sections (SHS), 25 mm to 150 mm.", "description": "Square hollow sections (SHS) to IS 4923 for columns, frames, facades and structural fabrication. Priced by weight.", "specifications": {"Profile": "Square", "Material": "Structural steel", "Length": "6 m"}, "variants": [{"slug": "25-x-25-mm", "name": "25 x 25 mm", "specifications": {"Size": "25 x 25 mm"}}, {"slug": "40-x-40-mm", "name": "40 x 40 mm", "specifications": {"Size": "40 x 40 mm"}}, {"slug": "50-x-50-mm", "name": "50 x 50 mm", "specifications": {"Size": "50 x 50 mm"}}, {"slug": "75-x-75-mm", "name": "75 x 75 mm", "specifications": {"Size": "75 x 75 mm"}}, {"slug": "100-x-100-mm", "name": "100 x 100 mm", "specifications": {"Size": "100 x 100 mm"}}, {"slug": "150-x-150-mm", "name": "150 x 150 mm", "specifications": {"Size": "150 x 150 mm"}}]},
      {"slug": "ms-rectangular-hollow-section", "name": "MS Rectangular Hollow Section", "category": "steel", "subcategory": "steel-hollow-sections", "brand": "apl-apollo", "unit": "Kg", "product_type": "Rectangular Hollow Section (RHS)", "standard": "IS 4923", "keywords": "rhs rectangular hollow section", "short_description": "Structural rectangular hollow sections (RHS), 40 x 20 mm to 200 x 100 mm.", "description": "Rectangular hollow sections (RHS) to IS 4923 for beams, frames, trusses and fabrication. Priced by weight.", "specifications": {"Profile": "Rectangular", "Material": "Structural steel", "Length": "6 m"}, "variants": [{"slug": "40-x-20-mm", "name": "40 x 20 mm", "specifications": {"Size": "40 x 20 mm"}}, {"slug": "60-x-40-mm", "name": "60 x 40 mm", "specifications": {"Size": "60 x 40 mm"}}, {"slug": "80-x-40-mm", "name": "80 x 40 mm", "specifications": {"Size": "80 x 40 mm"}}, {"slug": "100-x-50-mm", "name": "100 x 50 mm", "specifications": {"Size": "100 x 50 mm"}}, {"slug": "122-x-61-mm", "name": "122 x 61 mm", "specifications": {"Size": "122 x 61 mm"}}, {"slug": "200-x-100-mm", "name": "200 x 100 mm", "specifications": {"Size": "200 x 100 mm"}}]},
      {"slug": "ms-flat", "name": "MS Flat", "category": "steel", "subcategory": "steel-flats", "brand": "generic-steel", "unit": "Kg", "product_type": "Hot Rolled Flat", "standard": "IS 2062:2011", "keywords": "flat bar patti ms flat", "short_description": "Hot rolled mild steel flats, grade E250.", "description": "Mild steel flat bars in grade E250 for gates, grills, brackets, earthing strips and fabrication. Priced by weight.", "specifications": {"Grade": "E250", "Material": "Mild steel", "Length": "6 m"}, "variants": [{"slug": "25-x-5-mm", "name": "25 x 5 mm", "specifications": {"Size": "25 x 5 mm"}}, {"slug": "32-x-6-mm", "name": "32 x 6 mm", "specifications": {"Size": "32 x 6 mm"}}, {"slug": "40-x-6-mm", "name": "40 x 6 mm", "specifications": {"Size": "40 x 6 mm"}}, {"slug": "50-x-6-mm", "name": "50 x 6 mm", "specifications": {"Size": "50 x 6 mm"}}, {"slug": "50-x-10-mm", "name": "50 x 10 mm", "specifications": {"Size": "50 x 10 mm"}}, {"slug": "65-x-8-mm", "name": "65 x 8 mm", "specifications": {"Size": "65 x 8 mm"}}, {"slug": "75-x-10-mm", "name": "75 x 10 mm", "specifications": {"Size": "75 x 10 mm"}}, {"slug": "100-x-10-mm", "name": "100 x 10 mm", "specifications": {"Size": "100 x 10 mm"}}]},
      {"slug": "ms-round-bar", "name": "MS Round Bar", "category": "steel", "subcategory": "steel-rounds", "brand": "generic-steel", "unit": "Kg", "product_type": "Hot Rolled Round Bar", "standard": "IS 2062:2011", "keywords": "round bar ms round rod", "short_description": "Hot rolled mild steel round bars, 10 mm to 50 mm.", "description": "Plain mild steel round bars in grade E250 for anchors, shafts, fabrication and machining. Priced by weight.", "specifications": {"Grade": "E250", "Material": "Mild steel", "Length": "6 m"}, "variants": [{"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm"}}, {"slug": "32-mm", "name": "32 mm", "specifications": {"Diameter": "32 mm"}}, {"slug": "40-mm", "name": "40 mm", "specifications": {"Diameter": "40 mm"}}, {"slug": "50-mm", "name": "50 mm", "specifications": {"Diameter": "50 mm"}}]},
      {"slug": "ms-square-bar", "name": "MS Square Bar", "category": "steel", "subcategory": "steel-squares", "brand": "generic-steel", "unit": "Kg", "product_type": "Hot Rolled Square Bar", "standard": "IS 2062:2011", "keywords": "square bar ms square rod", "short_description": "Hot rolled mild steel square bars, 10 mm to 25 mm.", "description": "Mild steel square bars in grade E250 for grills, gates, railings and ornamental fabrication. Priced by weight.", "specifications": {"Grade": "E250", "Material": "Mild steel", "Length": "6 m"}, "variants": [{"slug": "10-x-10-mm", "name": "10 x 10 mm", "specifications": {"Size": "10 x 10 mm"}}, {"slug": "12-x-12-mm", "name": "12 x 12 mm", "specifications": {"Size": "12 x 12 mm"}}, {"slug": "16-x-16-mm", "name": "16 x 16 mm", "specifications": {"Size": "16 x 16 mm"}}, {"slug": "20-x-20-mm", "name": "20 x 20 mm", "specifications": {"Size": "20 x 20 mm"}}, {"slug": "25-x-25-mm", "name": "25 x 25 mm", "specifications": {"Size": "25 x 25 mm"}}]},
      {"slug": "binding-wire", "name": "Binding Wire", "category": "steel", "subcategory": "binding-wire", "brand": "generic-steel", "unit": "Kg", "product_type": "Annealed Binding Wire", "standard": "IS 280", "keywords": "binding wire tying wire annealed", "short_description": "Black annealed mild steel binding wire for tying reinforcement.", "description": "Soft, black annealed mild steel wire to IS 280, used to tie TMT bars at laps and crossings. Sold by weight, usually in 25 kg coils.", "specifications": {"Material": "Mild steel", "Finish": "Black annealed", "Coil": "25 kg"}, "variants": [{"slug": "16-swg-1-63-mm", "name": "16 SWG (1.63 mm)", "specifications": {"Gauge": "16 SWG", "Diameter": "1.63 mm"}}, {"slug": "18-swg-1-22-mm", "name": "18 SWG (1.22 mm)", "specifications": {"Gauge": "18 SWG", "Diameter": "1.22 mm"}}, {"slug": "20-swg-0-91-mm", "name": "20 SWG (0.91 mm)", "specifications": {"Gauge": "20 SWG", "Diameter": "0.91 mm"}}]},
      {"slug": "welded-steel-mesh", "name": "Welded Steel Mesh", "category": "steel", "subcategory": "steel-mesh", "brand": "generic-steel", "unit": "Sheet", "product_type": "Welded Wire Mesh Panel", "standard": "IS 4948", "keywords": "welded mesh wire mesh jali", "short_description": "Welded wire mesh panels for plaster, fencing and light reinforcement.", "description": "Welded steel wire mesh to IS 4948, used for plaster reinforcement, partitions, fencing and light concrete reinforcement. Sold per panel.", "specifications": {"Construction": "Welded at every intersection", "Panel Size": "2.4 m x 1.2 m"}, "variants": [{"slug": "50-x-50-mm-2-5-mm-wire", "name": "50 x 50 mm, 2.5 mm wire", "specifications": {"Opening": "50 x 50 mm", "Wire Diameter": "2.5 mm"}}, {"slug": "75-x-75-mm-3-mm-wire", "name": "75 x 75 mm, 3 mm wire", "specifications": {"Opening": "75 x 75 mm", "Wire Diameter": "3 mm"}}, {"slug": "100-x-100-mm-4-mm-wire", "name": "100 x 100 mm, 4 mm wire", "specifications": {"Opening": "100 x 100 mm", "Wire Diameter": "4 mm"}}]},
      {"slug": "reinforcement-mesh", "name": "Reinforcement Mesh", "category": "steel", "subcategory": "steel-mesh", "brand": "generic-steel", "unit": "Sheet", "product_type": "Steel Reinforcement Fabric", "standard": "IS 1566", "keywords": "reinforcement fabric mesh slab mesh", "short_description": "Hard-drawn steel wire fabric for slab and pavement reinforcement.", "description": "Hard-drawn steel wire fabric to IS 1566 for concrete slabs, pavements, floors and precast elements, replacing hand-tied bars for faster placement. Sold per sheet.", "specifications": {"Material": "Hard-drawn steel wire", "Sheet Size": "6 m x 2.4 m"}, "variants": [{"slug": "150-x-150-mm-6-mm-wire", "name": "150 x 150 mm, 6 mm wire", "specifications": {"Mesh Size": "150 x 150 mm", "Wire Diameter": "6 mm"}}, {"slug": "150-x-150-mm-8-mm-wire", "name": "150 x 150 mm, 8 mm wire", "specifications": {"Mesh Size": "150 x 150 mm", "Wire Diameter": "8 mm"}}, {"slug": "200-x-200-mm-8-mm-wire", "name": "200 x 200 mm, 8 mm wire", "specifications": {"Mesh Size": "200 x 200 mm", "Wire Diameter": "8 mm"}}]},
      {"slug": "stainless-steel-sheet", "name": "Stainless Steel Sheet", "category": "steel", "subcategory": "stainless-steel", "brand": "jindal-stainless", "unit": "Kg", "product_type": "Stainless Steel Sheet (304)", "standard": "IS 6911", "keywords": "ss sheet stainless 304", "short_description": "Grade 304 stainless steel sheets, 0.5 mm to 2 mm.", "description": "Austenitic grade 304 stainless steel sheets to IS 6911 for cladding, kitchens, enclosures and corrosion-resistant fabrication. Priced by weight.", "specifications": {"Grade": "304", "Finish": "2B / No. 4"}, "variants": [{"slug": "0-5-mm", "name": "0.5 mm", "specifications": {"Thickness": "0.5 mm"}}, {"slug": "0-8-mm", "name": "0.8 mm", "specifications": {"Thickness": "0.8 mm"}}, {"slug": "1-0-mm", "name": "1.0 mm", "specifications": {"Thickness": "1.0 mm"}}, {"slug": "1-2-mm", "name": "1.2 mm", "specifications": {"Thickness": "1.2 mm"}}, {"slug": "1-5-mm", "name": "1.5 mm", "specifications": {"Thickness": "1.5 mm"}}, {"slug": "2-0-mm", "name": "2.0 mm", "specifications": {"Thickness": "2.0 mm"}}]},
      {"slug": "stainless-steel-plate", "name": "Stainless Steel Plate", "category": "steel", "subcategory": "stainless-steel", "brand": "jindal-stainless", "unit": "Kg", "product_type": "Stainless Steel Plate (304)", "standard": "IS 6911", "keywords": "ss plate stainless 304", "short_description": "Grade 304 stainless steel plates, 3 mm to 12 mm.", "description": "Grade 304 stainless steel plates to IS 6911 for base plates, brackets, tanks and heavy corrosion-resistant fabrication.", "specifications": {"Grade": "304", "Finish": "No. 1 (hot rolled, annealed)"}, "variants": [{"slug": "3-mm", "name": "3 mm", "specifications": {"Thickness": "3 mm"}}, {"slug": "4-mm", "name": "4 mm", "specifications": {"Thickness": "4 mm"}}, {"slug": "5-mm", "name": "5 mm", "specifications": {"Thickness": "5 mm"}}, {"slug": "6-mm", "name": "6 mm", "specifications": {"Thickness": "6 mm"}}, {"slug": "8-mm", "name": "8 mm", "specifications": {"Thickness": "8 mm"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Thickness": "10 mm"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Thickness": "12 mm"}}]},
      {"slug": "stainless-steel-round-bar", "name": "Stainless Steel Round Bar", "category": "steel", "subcategory": "stainless-steel", "brand": "jindal-stainless", "unit": "Kg", "product_type": "Stainless Steel Round Bar (304)", "standard": "IS 6603", "keywords": "ss rod ss round bar stainless", "short_description": "Grade 304 stainless steel round bars, 6 mm to 25 mm.", "description": "Grade 304 stainless steel round bars to IS 6603 for anchors, fasteners, fittings and machined parts.", "specifications": {"Grade": "304", "Finish": "Bright"}, "variants": [{"slug": "6-mm", "name": "6 mm", "specifications": {"Diameter": "6 mm"}}, {"slug": "8-mm", "name": "8 mm", "specifications": {"Diameter": "8 mm"}}, {"slug": "10-mm", "name": "10 mm", "specifications": {"Diameter": "10 mm"}}, {"slug": "12-mm", "name": "12 mm", "specifications": {"Diameter": "12 mm"}}, {"slug": "16-mm", "name": "16 mm", "specifications": {"Diameter": "16 mm"}}, {"slug": "20-mm", "name": "20 mm", "specifications": {"Diameter": "20 mm"}}, {"slug": "25-mm", "name": "25 mm", "specifications": {"Diameter": "25 mm"}}]},
      {"slug": "stainless-steel-pipe", "name": "Stainless Steel Pipe", "category": "steel", "subcategory": "stainless-steel", "brand": "jindal-stainless", "unit": "Piece", "product_type": "Stainless Steel Welded Pipe (304)", "standard": "IS 13316", "keywords": "ss pipe railing pipe stainless", "short_description": "Grade 304 stainless steel welded pipes for railings and fabrication, 6 m long.", "description": "Grade 304 welded stainless steel pipes for railings, handrails, balustrades and decorative fabrication. Sold per 6 m length.", "specifications": {"Grade": "304", "Finish": "Polished", "Length": "6 m"}, "variants": [{"slug": "12-7-mm-od", "name": "12.7 mm OD", "specifications": {"Outside Diameter": "12.7 mm"}}, {"slug": "19-05-mm-od", "name": "19.05 mm OD", "specifications": {"Outside Diameter": "19.05 mm"}}, {"slug": "25-4-mm-od", "name": "25.4 mm OD", "specifications": {"Outside Diameter": "25.4 mm"}}, {"slug": "31-8-mm-od", "name": "31.8 mm OD", "specifications": {"Outside Diameter": "31.8 mm"}}, {"slug": "38-1-mm-od", "name": "38.1 mm OD", "specifications": {"Outside Diameter": "38.1 mm"}}, {"slug": "50-8-mm-od", "name": "50.8 mm OD", "specifications": {"Outside Diameter": "50.8 mm"}}]},
      {"slug": "galvanized-roofing-sheet", "name": "Galvanized Roofing Sheet", "category": "steel", "subcategory": "roofing-steel", "brand": "generic-steel", "unit": "SqFt", "product_type": "Galvanized Trapezoidal Roofing Sheet", "standard": "IS 277", "keywords": "roofing sheet galvanised trapezoidal", "short_description": "Galvanized trapezoidal profile roofing sheets, 0.40 mm to 0.50 mm.", "description": "Hot-dip galvanized steel roofing sheets in a trapezoidal profile for industrial sheds, warehouses and wall cladding. Priced per square foot.", "specifications": {"Coating": "Zinc galvanized", "Profile": "Trapezoidal"}, "variants": [{"slug": "0-40-mm", "name": "0.40 mm", "specifications": {"Thickness": "0.40 mm"}}, {"slug": "0-45-mm", "name": "0.45 mm", "specifications": {"Thickness": "0.45 mm"}}, {"slug": "0-50-mm", "name": "0.50 mm", "specifications": {"Thickness": "0.50 mm"}}]},
      {"slug": "color-coated-roofing-sheet", "name": "Color Coated Roofing Sheet", "category": "steel", "subcategory": "roofing-steel", "brand": "tata-bluescope", "unit": "SqFt", "product_type": "Colour Coated Roofing Sheet", "standard": "IS 14246", "keywords": "colour coated sheet color roofing ppgl", "short_description": "Pre-painted colour coated roofing sheets, 0.40 mm to 0.50 mm TCT.", "description": "Pre-painted galvalume / galvanized steel roofing sheets to IS 14246 in a range of colours, for roofs and wall cladding of homes, sheds and factories. Priced per square foot.", "specifications": {"Substrate": "Aluminium-zinc coated steel", "Coating": "Polyester paint", "Profile": "Trapezoidal"}, "variants": [{"slug": "0-40-mm-tct", "name": "0.40 mm TCT", "specifications": {"Total Coated Thickness": "0.40 mm"}}, {"slug": "0-45-mm-tct", "name": "0.45 mm TCT", "specifications": {"Total Coated Thickness": "0.45 mm"}}, {"slug": "0-50-mm-tct", "name": "0.50 mm TCT", "specifications": {"Total Coated Thickness": "0.50 mm"}}]},
      {"slug": "gi-roofing-sheet", "name": "GI Roofing Sheet", "category": "steel", "subcategory": "roofing-steel", "brand": "generic-steel", "unit": "SqFt", "product_type": "GI Corrugated Roofing Sheet", "standard": "IS 277", "keywords": "gi corrugated sheet tin sheet", "short_description": "GI corrugated roofing sheets, 0.40 mm to 0.63 mm.", "description": "Galvanized iron corrugated sheets to IS 277 for roofing of sheds, cattle sheds, temporary structures and site offices. Priced per square foot.", "specifications": {"Coating": "Zinc galvanized", "Profile": "Corrugated"}, "variants": [{"slug": "0-40-mm", "name": "0.40 mm", "specifications": {"Thickness": "0.40 mm"}}, {"slug": "0-50-mm", "name": "0.50 mm", "specifications": {"Thickness": "0.50 mm"}}, {"slug": "0-63-mm", "name": "0.63 mm", "specifications": {"Thickness": "0.63 mm"}}]},
      {"slug": "ms-bolts", "name": "MS Bolts", "category": "steel", "subcategory": "steel-fasteners", "brand": "generic-steel", "unit": "Piece", "product_type": "Hexagon Bolt (Property Class 4.6)", "standard": "IS 1363", "keywords": "bolt nut bolt ms bolt hex", "short_description": "Mild steel hexagon bolts, property class 4.6, M10 to M24.", "description": "Black mild steel hexagon head bolts to IS 1363, property class 4.6, for structural connections and fabrication.", "specifications": {"Property Class": "4.6", "Head": "Hexagon", "Finish": "Black"}, "variants": [{"slug": "m10", "name": "M10", "specifications": {"Thread": "M10"}}, {"slug": "m12", "name": "M12", "specifications": {"Thread": "M12"}}, {"slug": "m16", "name": "M16", "specifications": {"Thread": "M16"}}, {"slug": "m20", "name": "M20", "specifications": {"Thread": "M20"}}, {"slug": "m24", "name": "M24", "specifications": {"Thread": "M24"}}]},
      {"slug": "gi-bolts", "name": "GI Bolts", "category": "steel", "subcategory": "steel-fasteners", "brand": "generic-steel", "unit": "Piece", "product_type": "Hot-Dip Galvanized Hexagon Bolt", "standard": "IS 1363", "keywords": "gi bolt galvanised bolt", "short_description": "Hot-dip galvanized hexagon bolts for outdoor connections, M10 to M20.", "description": "Hot-dip galvanized hexagon head bolts to IS 1363, property class 4.6, for outdoor structures, towers and galvanized steelwork.", "specifications": {"Property Class": "4.6", "Head": "Hexagon", "Coating": "Hot-dip galvanized"}, "variants": [{"slug": "m10", "name": "M10", "specifications": {"Thread": "M10"}}, {"slug": "m12", "name": "M12", "specifications": {"Thread": "M12"}}, {"slug": "m16", "name": "M16", "specifications": {"Thread": "M16"}}, {"slug": "m20", "name": "M20", "specifications": {"Thread": "M20"}}]},
      {"slug": "steel-nuts", "name": "Steel Nuts", "category": "steel", "subcategory": "steel-fasteners", "brand": "generic-steel", "unit": "Piece", "product_type": "Hexagon Nut", "standard": "IS 1363", "keywords": "nut hex nut", "short_description": "Steel hexagon nuts, M10 to M24.", "description": "Steel hexagon nuts to IS 1363 (Part 3), matched to class 4.6 bolts for structural connections.", "specifications": {"Property Class": "4", "Type": "Hexagon"}, "variants": [{"slug": "m10", "name": "M10", "specifications": {"Thread": "M10"}}, {"slug": "m12", "name": "M12", "specifications": {"Thread": "M12"}}, {"slug": "m16", "name": "M16", "specifications": {"Thread": "M16"}}, {"slug": "m20", "name": "M20", "specifications": {"Thread": "M20"}}, {"slug": "m24", "name": "M24", "specifications": {"Thread": "M24"}}]},
      {"slug": "steel-washers", "name": "Steel Washers", "category": "steel", "subcategory": "steel-fasteners", "brand": "generic-steel", "unit": "Piece", "product_type": "Plain Washer", "standard": "IS 2016", "keywords": "washer plain washer", "short_description": "Plain steel washers, M10 to M24.", "description": "Plain steel washers to IS 2016 for spreading load under bolt heads and nuts in structural connections.", "specifications": {"Type": "Plain", "Material": "Mild steel"}, "variants": [{"slug": "m10", "name": "M10", "specifications": {"Bolt Size": "M10"}}, {"slug": "m12", "name": "M12", "specifications": {"Bolt Size": "M12"}}, {"slug": "m16", "name": "M16", "specifications": {"Bolt Size": "M16"}}, {"slug": "m20", "name": "M20", "specifications": {"Bolt Size": "M20"}}, {"slug": "m24", "name": "M24", "specifications": {"Bolt Size": "M24"}}]}
    ]$j$;

    -- #########################################################################
    -- CATALOG SECTION: TEMPLATE -- copy this block for a new catalog (Tiles,
    -- Electrical, Plumbing ...), remove the leading "--", rename tiles_*, fill
    -- it in, and add the names to COMBINE below. Slugs: lower case, words
    -- joined by "-", never changed once run (they are the keys).
    -- #########################################################################
    -- tiles_brands jsonb := $j$[
    --   {"slug": "kajaria", "name": "Kajaria", "manufacturer": "Kajaria Ceramics Limited", "description": "Ceramic and vitrified tiles.", "sort_order": 10}
    -- ]$j$;
    -- tiles_categories jsonb := $j$[
    --   {"slug": "tiles", "name": "Tiles", "description": "Floor and wall tiles.", "sort_order": 30, "subcategories": [
    --     {"slug": "vitrified-tiles", "name": "Vitrified Tiles", "description": "Glazed and double charged vitrified tiles.", "sort_order": 10}]}
    -- ]$j$;
    -- tiles_products jsonb := $j$[
    --   {"slug": "kajaria-glazed-vitrified-tile", "name": "Kajaria Glazed Vitrified Tile", "category": "tiles", "subcategory": "vitrified-tiles",
    --    "brand": "kajaria", "unit": "Box", "product_type": "Glazed Vitrified Tile", "standard": "IS 15622", "keywords": "tile floor tile gvt",
    --    "short_description": "...", "description": "...", "specifications": {"Finish": "Glossy"},
    --    "variants": [{"slug": "600x600-mm", "name": "600 x 600 mm", "size": "600 x 600 mm"}]}
    -- ]$j$;
    -- tiles_uses jsonb := $j${ "vitrified-tiles": "Floors and walls of homes, offices and showrooms" }$j$;
    -- (and add {"code": "Box", "name": "Box", "unit_family": "PACK", "sort_order": 15} to cfg_units)

    -- =========================================================================
    -- COMBINE -- every catalog section, in the order it should appear.
    -- Add a new section's names here, e.g. "|| tiles_brands".
    -- =========================================================================
    cfg_brands     jsonb := cement_brands     || steel_brands;
    cfg_categories jsonb := cement_categories || steel_categories;
    cfg_products   jsonb := cement_products   || steel_products;
    cfg_uses       jsonb := cement_uses       || steel_uses;

    -- =========================================================================
    -- WORKING VARIABLES
    -- =========================================================================
    v_row jsonb; v_sub jsonb; v_prod jsonb; v_variant jsonb;
    v_unit_id uuid; v_unit_name varchar; v_variant_unit_id uuid;
    v_brand_id uuid; v_brand_name varchar;
    v_category_id uuid; v_subcategory_id uuid;
    v_product_id uuid; v_variant_id uuid;
    v_keywords text; v_variant_specs jsonb; v_position integer;
    v_use text; v_sizes text; v_highlights jsonb; v_faqs jsonb;
    v_added integer := 0; v_existing integer := 0; v_retired integer := 0;
    v_supplier_before bigint; v_images_before bigint; v_bulk_before bigint;
    v_count bigint; v_missing text;
    v_added_products text[] := '{}';   -- slugs of the products this run inserted
BEGIN
    -- =========================================================================
    -- CHECKS: stop at once, with the reason
    -- =========================================================================
    IF current_database() NOT IN ('crewnbuild', 'crewnbuild_test') THEN
        RAISE EXCEPTION 'WRONG DATABASE: connected to "%", expected "crewnbuild" or "crewnbuild_test".', current_database();
    END IF;
    SELECT string_agg(name, ', ') INTO v_missing
      FROM (VALUES ('users'), ('files'), ('catalog_categories'), ('catalog_subcategories'), ('catalog_brands'),
                   ('catalog_units'), ('catalog_products'), ('catalog_product_variants'), ('catalog_product_media')
           ) AS expected (name)
     WHERE to_regclass('professional.' || expected.name) IS NULL;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'Database "%" has no professional.% table(s). Run the Professional migrations first.', current_database(), v_missing;
    END IF;
    IF cfg_country_code <> 'IN' THEN
        RAISE EXCEPTION 'cfg_country_code must be IN, not %.', cfg_country_code;
    END IF;
    -- Two catalog sections must never claim the same key: the second would be
    -- silently treated as "already exists" and its fields ignored.
    SELECT string_agg(slug, ', ') INTO v_sizes
      FROM (SELECT value->>'slug' AS slug FROM jsonb_array_elements(cfg_categories)
             GROUP BY 1 HAVING count(*) > 1) d;
    IF v_sizes IS NOT NULL THEN
        RAISE EXCEPTION 'Category slug(s) listed in more than one catalog section: %. Keep each category in one section.', v_sizes;
    END IF;
    SELECT string_agg(slug, ', ') INTO v_sizes
      FROM (SELECT value->>'slug' AS slug FROM jsonb_array_elements(cfg_products)
             GROUP BY 1 HAVING count(*) > 1) d;
    IF v_sizes IS NOT NULL THEN
        RAISE EXCEPTION 'Product slug(s) listed more than once: %. Every product slug must be unique.', v_sizes;
    END IF;
    SELECT string_agg(slug, ', ') INTO v_sizes
      FROM (SELECT value->>'slug' AS slug FROM jsonb_array_elements(cfg_brands)
             GROUP BY 1 HAVING count(DISTINCT value->>'name') > 1) d;
    IF v_sizes IS NOT NULL THEN
        RAISE EXCEPTION 'Brand slug(s) listed with different names: %. A shared brand must be listed identically.', v_sizes;
    END IF;
    v_sizes := NULL;

    -- This run's results, private to it (dropped when the run's transaction ends).
    CREATE TEMP TABLE IF NOT EXISTS catalog_seed_expected (
        kind        varchar,   -- 'category' | 'subcategory' | 'brand' | 'product'
        category    varchar,
        subcategory varchar,
        brand       varchar,
        product     varchar
    ) ON COMMIT DROP;
    CREATE TEMP TABLE IF NOT EXISTS catalog_seed_checks (
        check_no   varchar,
        check_name text,
        passed     boolean,
        detail     text
    ) ON COMMIT DROP;

    -- This run's results only.
    DELETE FROM catalog_seed_expected;
    DELETE FROM catalog_seed_checks;

    -- What this run must NOT change, counted before it writes anything (CHECK 10-12).
    SELECT count(*) INTO v_supplier_before FROM professional.supplier_listings;
    SELECT count(*) INTO v_images_before   FROM professional.catalog_product_media;
    SELECT count(*) INTO v_bulk_before    FROM professional.supplier_listing_price_tiers;

    -- =========================================================================
    -- UNITS -- one per code
    -- =========================================================================
    FOR v_row IN SELECT value FROM jsonb_array_elements(cfg_units) LOOP
        SELECT id INTO v_unit_id FROM professional.catalog_units WHERE code = v_row->>'code';
        IF v_unit_id IS NULL THEN
            INSERT INTO professional.catalog_units (code, name, unit_family, sort_order, is_active)
            VALUES (v_row->>'code', v_row->>'name', v_row->>'unit_family', COALESCE((v_row->>'sort_order')::integer, 0), true);
            v_added := v_added + 1;
            RAISE NOTICE 'Added  unit %', v_row->>'code';
        ELSE
            IF cfg_update_existing THEN
                UPDATE professional.catalog_units
                   SET name = v_row->>'name', unit_family = COALESCE(v_row->>'unit_family', unit_family)
                 WHERE id = v_unit_id;
            END IF;
            v_existing := v_existing + 1;
            RAISE NOTICE 'Exists unit %', v_row->>'code';
        END IF;
    END LOOP;

    -- =========================================================================
    -- BRANDS -- one per slug (logo_url is never written here)
    -- =========================================================================
    FOR v_row IN SELECT value FROM jsonb_array_elements(cfg_brands) LOOP
        INSERT INTO catalog_seed_expected (kind, brand) VALUES ('brand', v_row->>'slug');
        SELECT id INTO v_brand_id FROM professional.catalog_brands WHERE slug = v_row->>'slug';
        IF v_brand_id IS NULL THEN
            INSERT INTO professional.catalog_brands (slug, name, manufacturer, description, sort_order, is_active)
            VALUES (v_row->>'slug', v_row->>'name', v_row->>'manufacturer', v_row->>'description',
                    COALESCE((v_row->>'sort_order')::integer, 0), true);
            v_added := v_added + 1;
            RAISE NOTICE 'Added  brand %', v_row->>'name';
        ELSE
            IF cfg_update_existing THEN
                UPDATE professional.catalog_brands
                   SET name         = v_row->>'name',
                       manufacturer = COALESCE(v_row->>'manufacturer', manufacturer),
                       description  = COALESCE(v_row->>'description', description),
                       sort_order   = COALESCE((v_row->>'sort_order')::integer, sort_order),
                       updated_at   = now()
                 WHERE id = v_brand_id;
            END IF;
            v_existing := v_existing + 1;
            RAISE NOTICE 'Exists brand %', v_row->>'name';
        END IF;
    END LOOP;

    -- =========================================================================
    -- CATEGORIES -- one per (country, slug) -- and SUBCATEGORIES -- one per
    -- (category, slug). image_url is never written here.
    -- =========================================================================
    FOR v_row IN SELECT value FROM jsonb_array_elements(cfg_categories) LOOP
        INSERT INTO catalog_seed_expected (kind, category) VALUES ('category', v_row->>'slug');
        v_category_id := NULL;
        SELECT id INTO v_category_id FROM professional.catalog_categories
         WHERE country_code = cfg_country_code AND slug = v_row->>'slug';
        IF v_category_id IS NULL THEN
            INSERT INTO professional.catalog_categories (country_code, slug, name, description, sort_order, is_active)
            VALUES (cfg_country_code, v_row->>'slug', v_row->>'name', v_row->>'description',
                    COALESCE((v_row->>'sort_order')::integer, 0), true)
            RETURNING id INTO v_category_id;
            v_added := v_added + 1;
            RAISE NOTICE 'Added  category %', v_row->>'name';
        ELSE
            IF cfg_update_existing AND v_row ? 'name' THEN
                UPDATE professional.catalog_categories
                   SET name        = v_row->>'name',
                       description = COALESCE(v_row->>'description', description),
                       sort_order  = COALESCE((v_row->>'sort_order')::integer, sort_order),
                       updated_at  = now()
                 WHERE id = v_category_id;
            END IF;
            v_existing := v_existing + 1;
            RAISE NOTICE 'Exists category %', v_row->>'slug';
        END IF;

        FOR v_sub IN SELECT value FROM jsonb_array_elements(COALESCE(v_row->'subcategories', '[]'::jsonb)) LOOP
            INSERT INTO catalog_seed_expected (kind, category, subcategory) VALUES ('subcategory', v_row->>'slug', v_sub->>'slug');
            v_subcategory_id := NULL;
            SELECT id INTO v_subcategory_id FROM professional.catalog_subcategories
             WHERE category_id = v_category_id AND slug = v_sub->>'slug';
            IF v_subcategory_id IS NULL THEN
                INSERT INTO professional.catalog_subcategories (category_id, slug, name, description, sort_order, is_active)
                VALUES (v_category_id, v_sub->>'slug', v_sub->>'name', v_sub->>'description',
                        COALESCE((v_sub->>'sort_order')::integer, 0), true);
                v_added := v_added + 1;
                RAISE NOTICE 'Added  subcategory % > %', v_row->>'slug', v_sub->>'name';
            ELSE
                IF cfg_update_existing THEN
                    UPDATE professional.catalog_subcategories
                       SET name        = v_sub->>'name',
                           description = COALESCE(v_sub->>'description', description),
                           sort_order  = COALESCE((v_sub->>'sort_order')::integer, sort_order),
                           updated_at  = now()
                     WHERE id = v_subcategory_id;
                END IF;
                v_existing := v_existing + 1;
                RAISE NOTICE 'Exists subcategory % > %', v_row->>'slug', v_sub->>'slug';
            END IF;
        END LOOP;
    END LOOP;

    -- =========================================================================
    -- PRODUCTS -- one per (country, slug) -- and VARIANTS -- one per
    -- (product, slug). catalog_product_media is never written here.
    -- =========================================================================
    FOR v_prod IN SELECT value FROM jsonb_array_elements(cfg_products) LOOP
        IF coalesce(btrim(v_prod->>'slug'), '') = '' OR coalesce(btrim(v_prod->>'name'), '') = '' THEN
            RAISE EXCEPTION 'Every product needs a slug and a name.';
        END IF;
        INSERT INTO catalog_seed_expected (kind, category, subcategory, brand, product)
        VALUES ('product', v_prod->>'category', v_prod->>'subcategory', v_prod->>'brand', v_prod->>'slug');

        -- Subcategory, inside this country's category
        v_subcategory_id := NULL;
        SELECT s.id INTO v_subcategory_id
          FROM professional.catalog_subcategories s
          JOIN professional.catalog_categories c ON c.id = s.category_id
         WHERE c.country_code = cfg_country_code
           AND c.slug = v_prod->>'category'
           AND s.slug = v_prod->>'subcategory';
        IF v_subcategory_id IS NULL THEN
            RAISE EXCEPTION 'Product %: subcategory %/% does not exist (list it in cfg_categories).',
                v_prod->>'slug', v_prod->>'category', v_prod->>'subcategory';
        END IF;

        -- Brand, or none for a generic product
        v_brand_id := NULL;
        v_brand_name := NULL;
        IF jsonb_typeof(v_prod->'brand') = 'string' THEN
            SELECT id, name INTO v_brand_id, v_brand_name FROM professional.catalog_brands WHERE slug = v_prod->>'brand';
            IF v_brand_id IS NULL THEN
                RAISE EXCEPTION 'Product %: brand % does not exist (list it in cfg_brands).', v_prod->>'slug', v_prod->>'brand';
            END IF;
        END IF;

        -- Unit
        v_unit_id := NULL;
        v_unit_name := NULL;
        IF v_prod ? 'unit' THEN
            SELECT id, name INTO v_unit_id, v_unit_name FROM professional.catalog_units WHERE code = v_prod->>'unit';
            IF v_unit_id IS NULL THEN
                RAISE EXCEPTION 'Product %: unit % does not exist (list it in cfg_units).', v_prod->>'slug', v_prod->>'unit';
            END IF;
        END IF;

        -- Search keywords: the extra words plus every name the product is known by
        SELECT string_agg(DISTINCT lower(word), ' ')
          INTO v_keywords
          FROM regexp_split_to_table(
                   concat_ws(' ', v_prod->>'keywords', v_prod->>'name', v_brand_name,
                             (SELECT c.name || ' ' || s.name
                                FROM professional.catalog_subcategories s
                                JOIN professional.catalog_categories c ON c.id = s.category_id
                               WHERE s.id = v_subcategory_id),
                             v_prod->>'product_type', v_prod->>'standard', v_unit_name,
                             (SELECT string_agg(concat_ws(' ', item->>'name', item->>'size', item->>'grade'), ' ')
                                FROM jsonb_array_elements(v_prod->'variants') AS item)),
                   '[^[:alnum:].]+') AS word
         WHERE word <> '';

        -- Product page content when the product does not list its own:
        -- built from its use, specifications, standard and sizes.
        v_use := cfg_uses ->> (v_prod->>'subcategory');
        SELECT string_agg(item->>'name', ', ' ORDER BY ord) INTO v_sizes
          FROM jsonb_array_elements(v_prod->'variants') WITH ORDINALITY AS t(item, ord);

        IF jsonb_typeof(v_prod->'highlights') = 'array' THEN
            v_highlights := v_prod->'highlights';
        ELSE
            SELECT COALESCE(jsonb_agg(line ORDER BY ord), '[]'::jsonb) INTO v_highlights
              FROM (
                    SELECT 1 AS ord, v_use AS line
                    UNION ALL
                    SELECT 2, s.key || ': ' || s.value
                      FROM jsonb_each_text(COALESCE(v_prod->'specifications', '{}'::jsonb)) AS s
                    UNION ALL
                    SELECT 3, 'Conforms to ' || (v_prod->>'standard')
                    UNION ALL
                    SELECT 4, 'Available as: ' || v_sizes
                   ) AS h
             WHERE line IS NOT NULL;
        END IF;

        IF jsonb_typeof(v_prod->'faqs') = 'array' THEN
            v_faqs := v_prod->'faqs';
        ELSE
            SELECT COALESCE(jsonb_agg(jsonb_build_object('question', q, 'answer', ans) ORDER BY ord), '[]'::jsonb) INTO v_faqs
              FROM (VALUES
                      (1, 'What is ' || (v_prod->>'name') || ' used for?', v_use || '.'),
                      (3, 'Where can it be applied?', (v_prod->'specifications'->>'Application') || '.'),
                      (4, 'Which standard does it conform to?', v_prod->>'standard'),
                      (5, 'Which sizes is it available in?', v_sizes || '.')
                   ) AS f(ord, q, ans)
             WHERE ans IS NOT NULL;
        END IF;

        v_product_id := NULL;
        SELECT id INTO v_product_id FROM professional.catalog_products
         WHERE country_code = cfg_country_code AND slug = v_prod->>'slug';

        IF v_product_id IS NULL THEN
            INSERT INTO professional.catalog_products
                (country_code, subcategory_id, brand_id, slug, name, normalized_name,
                 short_description, description, product_type, standard_code, unit_id,
                 specifications, search_keywords, highlights, faqs, returns_exchange_policy, is_active)
            VALUES
                (cfg_country_code, v_subcategory_id, v_brand_id, v_prod->>'slug', v_prod->>'name',
                 lower(btrim(v_prod->>'name')), v_prod->>'short_description', v_prod->>'description',
                 v_prod->>'product_type', v_prod->>'standard', v_unit_id,
                 COALESCE(v_prod->'specifications', '{}'::jsonb), v_keywords, v_highlights, v_faqs,
                 COALESCE(NULLIF(btrim(v_prod->>'returns_exchange_policy'), ''), cfg_returns_policy), true)
            RETURNING id INTO v_product_id;
            v_added_products := v_added_products || (v_prod->>'slug');
            v_added := v_added + 1;
            RAISE NOTICE 'Added  product % > % > %', v_prod->>'subcategory', COALESCE(v_brand_name, 'Generic'), v_prod->>'name';
        ELSE
            IF cfg_update_existing THEN
                UPDATE professional.catalog_products
                   SET subcategory_id    = v_subcategory_id,
                       brand_id          = v_brand_id,
                       name              = v_prod->>'name',
                       normalized_name   = lower(btrim(v_prod->>'name')),
                       short_description = COALESCE(v_prod->>'short_description', short_description),
                       description       = COALESCE(v_prod->>'description', description),
                       product_type      = COALESCE(v_prod->>'product_type', product_type),
                       standard_code     = COALESCE(v_prod->>'standard', standard_code),
                       unit_id           = COALESCE(v_unit_id, unit_id),
                       specifications    = COALESCE(v_prod->'specifications', specifications),
                       search_keywords   = v_keywords,
                       highlights        = CASE WHEN jsonb_typeof(v_prod->'highlights') = 'array' THEN v_prod->'highlights' ELSE highlights END,
                       faqs              = CASE WHEN jsonb_typeof(v_prod->'faqs') = 'array' THEN v_prod->'faqs' ELSE faqs END,
                       returns_exchange_policy = COALESCE(NULLIF(btrim(v_prod->>'returns_exchange_policy'), ''), returns_exchange_policy),
                       updated_at        = now()
                 WHERE id = v_product_id;
            END IF;
            v_existing := v_existing + 1;
            RAISE NOTICE 'Exists product %', v_prod->>'slug';
        END IF;

        -- Variants: new ones are added after the product's existing ones.
        SELECT COALESCE(max(sort_order), 0) INTO v_position
          FROM professional.catalog_product_variants WHERE product_id = v_product_id;
        FOR v_variant IN SELECT value FROM jsonb_array_elements(v_prod->'variants') LOOP
            IF coalesce(btrim(v_variant->>'slug'), '') = '' OR coalesce(btrim(v_variant->>'name'), '') = '' THEN
                RAISE EXCEPTION 'Product %: every variant needs a slug and a name.', v_prod->>'slug';
            END IF;

            v_variant_unit_id := v_unit_id;
            IF v_variant ? 'unit' THEN
                v_variant_unit_id := NULL;
                SELECT id INTO v_variant_unit_id FROM professional.catalog_units WHERE code = v_variant->>'unit';
                IF v_variant_unit_id IS NULL THEN
                    RAISE EXCEPTION 'Product % variant %: unit % does not exist.', v_prod->>'slug', v_variant->>'slug', v_variant->>'unit';
                END IF;
            END IF;

            -- The variant's own specifications, plus Size / Pack Size and Grade when a
            -- variant lists "size" / "grade" (the variants table has no separate
            -- columns for them). The Steel variants carry everything in
            -- "specifications", so nothing is added for them.
            v_variant_specs := COALESCE(v_variant->'specifications', '{}'::jsonb)
                               || jsonb_strip_nulls(jsonb_build_object('Size', v_variant->>'size', 'Pack Size', v_variant->>'size',
                                                                       'Grade', v_variant->>'grade'));

            v_variant_id := NULL;
            SELECT id INTO v_variant_id FROM professional.catalog_product_variants
             WHERE product_id = v_product_id AND slug = v_variant->>'slug';
            IF v_variant_id IS NULL THEN
                v_position := v_position + 10;
                INSERT INTO professional.catalog_product_variants
                    (product_id, slug, name, unit_id, specifications, sort_order, is_active)
                VALUES (v_product_id, v_variant->>'slug', v_variant->>'name', v_variant_unit_id, v_variant_specs, v_position, true);
                v_added := v_added + 1;
                RAISE NOTICE '         + variant %', v_variant->>'name';
            ELSIF cfg_update_existing THEN
                UPDATE professional.catalog_product_variants
                   SET name = v_variant->>'name', unit_id = v_variant_unit_id,
                       specifications = v_variant_specs, updated_at = now()
                 WHERE id = v_variant_id;
            END IF;
        END LOOP;
    END LOOP;

    -- =========================================================================
    -- RETIRE (opt-in) -- deactivate, never delete, what the lists no longer
    -- contain. Only this country's rows; referenced rows stay in place.
    -- =========================================================================
    IF cfg_retire_unlisted THEN
        UPDATE professional.catalog_categories c
           SET is_active = false, updated_at = now()
         WHERE c.country_code = cfg_country_code AND c.is_active
           AND c.slug NOT IN (SELECT value->>'slug' FROM jsonb_array_elements(cfg_categories));
        GET DIAGNOSTICS v_count = ROW_COUNT; v_retired := v_retired + v_count;

        UPDATE professional.catalog_subcategories s
           SET is_active = false, updated_at = now()
          FROM professional.catalog_categories c
         WHERE c.id = s.category_id AND c.country_code = cfg_country_code AND s.is_active
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cfg_categories) cat,
                                         jsonb_array_elements(COALESCE(cat->'subcategories', '[]'::jsonb)) sub
                            WHERE cat->>'slug' = c.slug AND sub->>'slug' = s.slug);
        GET DIAGNOSTICS v_count = ROW_COUNT; v_retired := v_retired + v_count;

        UPDATE professional.catalog_products p
           SET is_active = false, updated_at = now()
         WHERE p.country_code = cfg_country_code AND p.is_active
           AND p.slug NOT IN (SELECT value->>'slug' FROM jsonb_array_elements(cfg_products));
        GET DIAGNOSTICS v_count = ROW_COUNT; v_retired := v_retired + v_count;
        RAISE NOTICE 'Retired (is_active = false): % row(s).', v_retired;
    END IF;

    -- =========================================================================
    -- CHECKS that need the counts from before the run. Any failure raises,
    -- which rolls the whole run back.
    -- =========================================================================
    SELECT count(*) INTO v_count FROM professional.supplier_listings;
    INSERT INTO catalog_seed_checks VALUES ('10', 'No supplier_listings created or changed', v_count = v_supplier_before,
        format('%s before, %s after', v_supplier_before, v_count));
    IF v_count <> v_supplier_before THEN
        RAISE EXCEPTION 'CHECK 10 failed: supplier_listings changed (% -> %).', v_supplier_before, v_count;
    END IF;

    SELECT count(*) INTO v_count FROM professional.catalog_product_media;
    INSERT INTO catalog_seed_checks VALUES ('11', 'No catalog_product_media created or changed', v_count = v_images_before,
        format('%s before, %s after', v_images_before, v_count));
    IF v_count <> v_images_before THEN
        RAISE EXCEPTION 'CHECK 11 failed: catalog_product_media changed (% -> %).', v_images_before, v_count;
    END IF;

    SELECT count(*) INTO v_count FROM professional.supplier_listing_price_tiers;
    INSERT INTO catalog_seed_checks VALUES ('12', 'No supplier_listing_price_tiers created or changed', v_count = v_bulk_before,
        format('%s before, %s after', v_bulk_before, v_count));
    IF v_count <> v_bulk_before THEN
        RAISE EXCEPTION 'CHECK 12 failed: supplier_listing_price_tiers changed (% -> %).', v_bulk_before, v_count;
    END IF;

    -- Every product this run added must be reachable through the supplier's
    -- dropdowns: active category -> active subcategory -> active brand ->
    -- active product -> active variant, in this country. A product that already
    -- existed is left as the admin has it -- withdrawn (inactive) or moved -- so
    -- it is reported, not refused: one withdrawn product must not block every
    -- other catalog section's run.
    SELECT count(*) FILTER (WHERE e.product = ANY (v_added_products)),
           string_agg(e.product, ', ') FILTER (WHERE NOT (e.product = ANY (v_added_products)))
      INTO v_count, v_sizes
      FROM catalog_seed_expected e
     WHERE e.kind = 'product'
       AND NOT EXISTS (
            SELECT 1
              FROM professional.catalog_products p
              JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id AND s.is_active
              JOIN professional.catalog_categories c    ON c.id = s.category_id AND c.is_active
              LEFT JOIN professional.catalog_brands b   ON b.id = p.brand_id
             WHERE p.country_code = cfg_country_code AND p.slug = e.product AND p.is_active
               AND c.slug = e.category AND s.slug = e.subcategory
               AND ((e.brand IS NULL AND p.brand_id IS NULL) OR (b.slug = e.brand AND b.is_active))
               AND (NOT EXISTS (SELECT 1 FROM professional.catalog_product_variants v0 WHERE v0.product_id = p.id)
                    OR EXISTS (SELECT 1 FROM professional.catalog_product_variants v WHERE v.product_id = p.id AND v.is_active)));
    IF v_count > 0 THEN
        RAISE EXCEPTION 'CHECK failed: % product(s) added by this run are not reachable Category -> Subcategory -> Brand -> Product (-> active Variant when it has variants).', v_count;
    END IF;
    IF v_sizes IS NOT NULL THEN
        RAISE NOTICE 'Not in the supplier dropdowns, left as the admin has them (inactive, or moved to another category / brand): %', v_sizes;
    END IF;

    RAISE NOTICE 'CHECK 10-12 ok; every product this run added is reachable from the supplier dropdowns.';
    RAISE NOTICE 'Done: % row(s) added, % already existed%.', v_added, v_existing,
        CASE WHEN cfg_update_existing THEN ' (updated)' ELSE ' (left unchanged)' END;
END
$seed$;

-- #############################################################################
--  CREWNBUILD -- MASTER CATALOG: AGGREGATES, BRICKS, PIPES (India, country 'IN')
--  Database: crewnbuild (or crewnbuild_test)   Schema: professional   PostgreSQL 18
--
--  Adds three categories in the same shape as Steel and Cement in
--  app/seeds/master_catalog_seed.sql (which this file does not change):
--
--    Aggregates  sort 30   7 subcategories   0 brands   8 products    5 variants
--    Bricks      sort 40   6 subcategories   4 brands  11 products   20 variants
--    Pipes       sort 50   8 subcategories   8 brands  25 products  132 variants
--    Units       Metre (LENGTH), new; Tonne, Piece, SqFt are reused
--    Total       1 unit, 12 brands, 3 categories, 21 subcategories,
--                44 products, 157 variants  (238 rows)
--
--  Rules followed (as the existing seed does):
--    * Rows are looked up by their natural key and inserted only when missing.
--      catalog_categories and catalog_products are unique on (country_code, slug)
--      through PARTIAL indexes, so they use WHERE NOT EXISTS; the other tables
--      use ON CONFLICT DO NOTHING. No existing row is ever updated or deleted.
--    * Generic products have brand_id NULL (the supplier sees "Generic (no brand)").
--    * A variant stores its product's unit_id; normalized_name, search_keywords,
--      highlights and faqs are built exactly as the seed builds them.
--    * Images, logos, supplier listings and price tiers are never written.
--    * Where a size, class or standard was not certain, nothing is invented: the
--      product has no variants (it is sold in one form, like White Cement) or the
--      standard is left empty. Sizes can be added later in Admin > Master Catalog.
--
--  HOW TO RUN (from the repository root, after `python scripts\migrate.py`)
--    psql -d crewnbuild -v ON_ERROR_STOP=1 -f professional/scripts/catalog_aggregates_bricks_pipes.sql
--
--  DRY RUN: change the last line "COMMIT;" to "ROLLBACK;" and run it. Every
--  check below still runs and prints its result, then nothing is kept.
--  Any error (a failed guard included) aborts the transaction, so nothing is
--  written; with ON_ERROR_STOP the run also stops at once.
--
--  SAFE TO RUN AGAIN: a second run adds 0 rows and prints the same checks.
-- #############################################################################

-- The file is UTF-8 ("kgf/cm²"); psql on Windows would otherwise read it in the
-- console code page.
SET client_encoding = 'UTF8';

BEGIN;

-- =============================================================================
-- 1. THE DATA (temporary tables, private to this run, dropped at the end)
-- =============================================================================

CREATE TEMP TABLE new_policies (
    kind        text PRIMARY KEY,
    policy_text text NOT NULL
) ON COMMIT DROP;

INSERT INTO new_policies VALUES
-- Loose material delivered by the load: aggregates and sand.
('loose', $policy$1. Loose material is non-returnable once delivered and unloaded at site.
2. Check the load at delivery against the delivery challan or weighbridge slip and note any shortfall or problem on it.
3. Replacement or credit available only if reported within 24 hours of delivery for:
   - Wrong material or wrong size
   - Short quantity
   - Material mixed with soil, clay or other foreign matter
4. Material that has been mixed, spread or used cannot be replaced
5. Refer to Refund Policy for complete details$policy$),
-- The seed's own default (cfg_returns_policy), word for word: bricks and pipes.
('standard', $policy$1. This product is non-returnable.
2. Replacement available within 24 hours of delivery for:
   - Damaged or defective product
   - Wrong or missing item
3. Product cannot be returned once opened or used
4. Refer to Refund Policy for complete details$policy$);

CREATE TEMP TABLE new_categories (
    slug        text PRIMARY KEY,
    name        text NOT NULL,
    description text NOT NULL,
    sort_order  integer NOT NULL
) ON COMMIT DROP;

INSERT INTO new_categories VALUES
('aggregates', 'Aggregates', 'Coarse aggregate, river sand, manufactured sand, stone dust, road base material and rubble for construction.', 30),
('bricks',     'Bricks',     'Clay and fly ash bricks, AAC, concrete and hollow clay blocks, and paver blocks for walls and paving.', 40),
('pipes',      'Pipes',      'CPVC, uPVC, PVC, HDPE, PPR, ductile iron and RCC pipes for water supply and drainage.', 50);

-- "uses" is the seed's <name>_uses text: the first highlight and the first FAQ.
CREATE TEMP TABLE new_subcategories (
    category    text NOT NULL,
    slug        text NOT NULL,
    name        text NOT NULL,
    description text NOT NULL,
    sort_order  integer NOT NULL,
    uses        text NOT NULL,
    PRIMARY KEY (category, slug)
) ON COMMIT DROP;

INSERT INTO new_subcategories VALUES
-- Aggregates
('aggregates', 'coarse-aggregate', 'Coarse Aggregate', 'Crushed stone coarse aggregate (blue metal / jelly) in single nominal sizes (IS 383:2016).', 10, 'Concrete for foundations, columns, beams and slabs, and road and drainage work'),
('aggregates', 'river-sand',       'River Sand',       'Natural river sand used as fine aggregate (IS 383:2016).', 20, 'Concrete, masonry mortar and plastering'),
('aggregates', 'm-sand',           'M-Sand',           'Manufactured sand made by crushing stone, used as fine aggregate in concrete (IS 383:2016).', 30, 'Concrete and masonry mortar, as a replacement for river sand'),
('aggregates', 'p-sand',           'P-Sand',           'Manufactured sand graded for plastering.', 40, 'Wall and ceiling plastering'),
('aggregates', 'stone-dust',       'Stone Dust',       'Quarry or crusher dust, the fine material left from crushing stone.', 50, 'Filling, levelling and bedding under paver blocks'),
('aggregates', 'gsb-wmm',          'GSB & WMM',        'Granular sub base and wet mix macadam for road and yard base layers.', 60, 'Sub base and base layers of roads, driveways and yards'),
('aggregates', 'rubble-boulders',  'Rubble & Boulders','Rubble stone and boulders for masonry, soling and filling.', 70, 'Rubble masonry foundations, retaining walls, plinth filling and soling'),
-- Bricks
('bricks', 'red-clay-bricks',    'Red Clay Bricks',    'Common burnt clay building bricks, hand moulded and wire cut (IS 1077).', 10, 'Load bearing and partition walls, compound walls and general masonry'),
('bricks', 'fly-ash-bricks',     'Fly Ash Bricks',     'Fly ash bricks for walls and masonry (IS 12894).', 20, 'Load bearing and partition walls and general masonry'),
('bricks', 'aac-blocks',         'AAC Blocks',         'Autoclaved aerated concrete blocks (IS 2185 Part 3).', 30, 'Lightweight internal and external walls in framed buildings'),
('bricks', 'concrete-blocks',    'Concrete Blocks',    'Solid and hollow concrete masonry blocks (IS 2185 Part 1).', 40, 'Load bearing walls, partition walls and compound walls'),
('bricks', 'hollow-clay-blocks', 'Hollow Clay Blocks', 'Burnt clay hollow blocks for walls and partitions (IS 3952).', 50, 'Internal and external walls in framed buildings'),
('bricks', 'paver-blocks',       'Paver Blocks',       'Precast concrete paver blocks (IS 15658).', 60, 'Driveways, parking areas, footpaths and outdoor flooring'),
-- Pipes
('pipes', 'cpvc-pipes',         'CPVC Pipes',          'CPVC pipes for hot and cold water supply (IS 15778).', 10, 'Hot and cold water supply lines inside buildings'),
('pipes', 'upvc-pipes',         'uPVC Pipes',          'uPVC plumbing pipes, Schedule 40, in inch sizes.', 20, 'Cold water supply lines inside and outside buildings'),
('pipes', 'pvc-pressure-pipes', 'PVC Pressure Pipes',  'Unplasticized PVC pressure pipes for water supply (IS 4985).', 30, 'Water mains, borewell and pumping lines and irrigation'),
('pipes', 'swr-pipes',          'SWR Drainage Pipes',  'uPVC soil, waste and rainwater pipes (IS 13592).', 40, 'Soil, waste and rainwater drainage in buildings'),
('pipes', 'hdpe-pipes',         'HDPE Pipes',          'High density polyethylene pipes for water supply (IS 4984).', 50, 'Water supply mains, borewell lines and underground water lines'),
('pipes', 'ppr-pipes',          'PPR Pipes',           'Polypropylene random copolymer pipes for hot and cold water.', 60, 'Hot and cold water supply lines inside buildings'),
('pipes', 'di-pipes',           'Ductile Iron Pipes',  'Ductile iron pipes for water mains (IS 8329).', 70, 'Water supply mains and pumping lines'),
('pipes', 'rcc-hume-pipes',     'RCC Hume Pipes',      'Precast reinforced cement concrete pipes, non-pressure classes (IS 458).', 80, 'Storm water drains, culverts, sewers and road crossings');

-- Brand slugs are global. "electrosteel" (ESL Steel) and "apl-apollo" are taken
-- by other companies, so the new ones use their own slugs.
CREATE TEMP TABLE new_brands (
    slug         text PRIMARY KEY,
    name         text NOT NULL,
    manufacturer text NOT NULL,
    description  text NOT NULL,
    sort_order   integer NOT NULL
) ON COMMIT DROP;

INSERT INTO new_brands VALUES
-- Bricks
('magicrete',             'Magicrete',             'Magicrete Building Solutions Private Limited', 'AAC blocks.', 210),
('biltech',               'Biltech',               'Biltech Building Elements Limited',            'AAC blocks.', 220),
('birla-aerocon',         'Birla Aerocon',         'HIL Limited',                                  'AAC blocks from HIL.', 230),
('porotherm',             'Porotherm',             'Wienerberger India Private Limited',           'Burnt clay hollow blocks from Wienerberger.', 240),
-- Pipes
('astral',                'Astral',                'Astral Limited',                               'CPVC, uPVC and SWR pipes.', 310),
('ashirvad',              'Ashirvad',              'Ashirvad Pipes Private Limited',               'CPVC, uPVC and SWR pipes.', 320),
('supreme',               'Supreme',               'The Supreme Industries Limited',               'CPVC, uPVC, PVC pressure and SWR pipes.', 330),
('finolex-pipes',         'Finolex',               'Finolex Industries Limited',                   'CPVC, uPVC, PVC pressure and SWR pipes.', 340),
('prince-pipes',          'Prince',                'Prince Pipes and Fittings Limited',            'CPVC, uPVC, PVC pressure and SWR pipes.', 350),
('jain-irrigation',       'Jain',                  'Jain Irrigation Systems Limited',              'HDPE pipes.', 360),
('electrosteel-castings', 'Electrosteel Castings', 'Electrosteel Castings Limited',                'Ductile iron pipes.', 370),
('jindal-saw',            'Jindal SAW',            'Jindal Saw Limited',                           'Ductile iron pipes.', 380);

-- Variant lists, shared by the products that are sold in the same sizes.
-- position x 10 = sort_order, as the seed numbers a new product's variants.
CREATE TEMP TABLE new_variant_sets (
    set_name       text NOT NULL,
    position       integer NOT NULL,
    slug           text NOT NULL,
    name           text NOT NULL,
    specifications jsonb NOT NULL,
    PRIMARY KEY (set_name, slug)
) ON COMMIT DROP;

INSERT INTO new_variant_sets VALUES
('coarse-aggregate', 1, '6-mm',  '6 mm',  '{"Nominal Size": "6 mm"}'),
('coarse-aggregate', 2, '10-mm', '10 mm', '{"Nominal Size": "10 mm"}'),
('coarse-aggregate', 3, '12-mm', '12 mm', '{"Nominal Size": "12 mm"}'),
('coarse-aggregate', 4, '20-mm', '20 mm', '{"Nominal Size": "20 mm"}'),
('coarse-aggregate', 5, '40-mm', '40 mm', '{"Nominal Size": "40 mm"}'),

('aac-block', 1, '600x200x100-mm', '600 x 200 x 100 mm', '{"Length": "600 mm", "Height": "200 mm", "Thickness": "100 mm"}'),
('aac-block', 2, '600x200x150-mm', '600 x 200 x 150 mm', '{"Length": "600 mm", "Height": "200 mm", "Thickness": "150 mm"}'),
('aac-block', 3, '600x200x200-mm', '600 x 200 x 200 mm', '{"Length": "600 mm", "Height": "200 mm", "Thickness": "200 mm"}'),

('concrete-block', 1, '400x200x100-mm', '400 x 200 x 100 mm', '{"Length": "400 mm", "Height": "200 mm", "Thickness": "100 mm"}'),
('concrete-block', 2, '400x200x150-mm', '400 x 200 x 150 mm', '{"Length": "400 mm", "Height": "200 mm", "Thickness": "150 mm"}'),
('concrete-block', 3, '400x200x200-mm', '400 x 200 x 200 mm', '{"Length": "400 mm", "Height": "200 mm", "Thickness": "200 mm"}'),

('paver-block', 1, '60-mm', '60 mm', '{"Thickness": "60 mm"}'),
('paver-block', 2, '80-mm', '80 mm', '{"Thickness": "80 mm"}'),

('pipe-inch', 1, '1-2-inch',   '1/2 inch',   '{"Nominal Size": "1/2 inch"}'),
('pipe-inch', 2, '3-4-inch',   '3/4 inch',   '{"Nominal Size": "3/4 inch"}'),
('pipe-inch', 3, '1-inch',     '1 inch',     '{"Nominal Size": "1 inch"}'),
('pipe-inch', 4, '1-1-4-inch', '1 1/4 inch', '{"Nominal Size": "1 1/4 inch"}'),
('pipe-inch', 5, '1-1-2-inch', '1 1/2 inch', '{"Nominal Size": "1 1/2 inch"}'),
('pipe-inch', 6, '2-inch',     '2 inch',     '{"Nominal Size": "2 inch"}'),

('pvc-pressure', 1, '63-mm',  '63 mm',  '{"Outside Diameter": "63 mm"}'),
('pvc-pressure', 2, '75-mm',  '75 mm',  '{"Outside Diameter": "75 mm"}'),
('pvc-pressure', 3, '90-mm',  '90 mm',  '{"Outside Diameter": "90 mm"}'),
('pvc-pressure', 4, '110-mm', '110 mm', '{"Outside Diameter": "110 mm"}'),
('pvc-pressure', 5, '140-mm', '140 mm', '{"Outside Diameter": "140 mm"}'),
('pvc-pressure', 6, '160-mm', '160 mm', '{"Outside Diameter": "160 mm"}'),

('swr', 1, '75-mm',  '75 mm',  '{"Outside Diameter": "75 mm"}'),
('swr', 2, '110-mm', '110 mm', '{"Outside Diameter": "110 mm"}'),
('swr', 3, '160-mm', '160 mm', '{"Outside Diameter": "160 mm"}'),

('hdpe', 1, '32-mm',  '32 mm',  '{"Outside Diameter": "32 mm"}'),
('hdpe', 2, '40-mm',  '40 mm',  '{"Outside Diameter": "40 mm"}'),
('hdpe', 3, '50-mm',  '50 mm',  '{"Outside Diameter": "50 mm"}'),
('hdpe', 4, '63-mm',  '63 mm',  '{"Outside Diameter": "63 mm"}'),
('hdpe', 5, '75-mm',  '75 mm',  '{"Outside Diameter": "75 mm"}'),
('hdpe', 6, '90-mm',  '90 mm',  '{"Outside Diameter": "90 mm"}'),
('hdpe', 7, '110-mm', '110 mm', '{"Outside Diameter": "110 mm"}'),

('ppr', 1, '20-mm', '20 mm', '{"Outside Diameter": "20 mm"}'),
('ppr', 2, '25-mm', '25 mm', '{"Outside Diameter": "25 mm"}'),
('ppr', 3, '32-mm', '32 mm', '{"Outside Diameter": "32 mm"}'),
('ppr', 4, '40-mm', '40 mm', '{"Outside Diameter": "40 mm"}'),
('ppr', 5, '50-mm', '50 mm', '{"Outside Diameter": "50 mm"}'),

('di', 1, 'dn-100', 'DN 100', '{"Nominal Diameter": "DN 100"}'),
('di', 2, 'dn-150', 'DN 150', '{"Nominal Diameter": "DN 150"}'),
('di', 3, 'dn-200', 'DN 200', '{"Nominal Diameter": "DN 200"}'),
('di', 4, 'dn-250', 'DN 250', '{"Nominal Diameter": "DN 250"}'),
('di', 5, 'dn-300', 'DN 300', '{"Nominal Diameter": "DN 300"}'),

('rcc-hume', 1, '300-mm',  '300 mm',  '{"Internal Diameter": "300 mm"}'),
('rcc-hume', 2, '450-mm',  '450 mm',  '{"Internal Diameter": "450 mm"}'),
('rcc-hume', 3, '600-mm',  '600 mm',  '{"Internal Diameter": "600 mm"}'),
('rcc-hume', 4, '900-mm',  '900 mm',  '{"Internal Diameter": "900 mm"}'),
('rcc-hume', 5, '1200-mm', '1200 mm', '{"Internal Diameter": "1200 mm"}');

-- variant_set NULL: sold in one form, no variant (as White Cement).
CREATE TEMP TABLE new_products (
    slug              text PRIMARY KEY,
    name              text NOT NULL,
    category          text NOT NULL,
    subcategory       text NOT NULL,
    brand             text,
    unit              text NOT NULL,
    product_type      text NOT NULL,
    standard          text,
    keywords          text NOT NULL,
    short_description text NOT NULL,
    description       text NOT NULL,
    specifications    jsonb NOT NULL,
    policy            text NOT NULL,
    variant_set       text
) ON COMMIT DROP;

INSERT INTO new_products VALUES
-- ---- Aggregates (generic, Tonne, loose-material policy) ----
('crushed-stone-aggregate', 'Crushed Stone Aggregate', 'aggregates', 'coarse-aggregate', NULL, 'Tonne', 'Crushed Stone Coarse Aggregate', 'IS 383:2016',
 'aggregate gitti jelly blue metal stone chips crushed stone',
 'Crushed stone coarse aggregate (blue metal / jelly), sold by the tonne.',
 'Crushed stone coarse aggregate conforming to IS 383:2016, for concrete, foundations and road work. Sold loose by the tonne in single nominal sizes.',
 '{"Type": "Coarse aggregate", "Material": "Crushed stone"}', 'loose', 'coarse-aggregate'),
('natural-river-sand', 'Natural River Sand', 'aggregates', 'river-sand', NULL, 'Tonne', 'Natural River Sand', 'IS 383:2016',
 'sand reti balu river sand fine aggregate',
 'Natural river sand (fine aggregate), sold by the tonne.',
 'Natural river sand used as fine aggregate under IS 383:2016, for concrete, masonry mortar and plastering. Sold loose by the tonne.',
 '{"Type": "Fine aggregate", "Material": "Natural river sand"}', 'loose', NULL),
('m-sand-for-concrete', 'M-Sand for Concrete', 'aggregates', 'm-sand', NULL, 'Tonne', 'Manufactured Sand', 'IS 383:2016',
 'sand msand manufactured sand crushed sand reti fine aggregate',
 'Manufactured sand for concrete and masonry, sold by the tonne.',
 'Manufactured sand made by crushing stone, used as fine aggregate under IS 383:2016 in concrete and masonry mortar. Sold loose by the tonne.',
 '{"Type": "Fine aggregate", "Material": "Manufactured sand (crushed stone)"}', 'loose', NULL),
('p-sand-for-plastering', 'P-Sand for Plastering', 'aggregates', 'p-sand', NULL, 'Tonne', 'Plastering Sand', NULL,
 'sand psand plastering sand plaster sand manufactured sand reti',
 'Manufactured sand graded for plastering, sold by the tonne.',
 'Manufactured sand graded for wall and ceiling plastering. Sold loose by the tonne.',
 '{"Type": "Plastering sand", "Material": "Manufactured sand (crushed stone)"}', 'loose', NULL),
('stone-dust', 'Stone Dust', 'aggregates', 'stone-dust', NULL, 'Tonne', 'Stone Dust', NULL,
 'stone dust quarry dust crusher dust',
 'Quarry or crusher stone dust, sold by the tonne.',
 'Stone dust from crushing stone, for filling, levelling and bedding under paver blocks. Sold loose by the tonne.',
 '{"Type": "Quarry dust", "Material": "Crushed stone fines"}', 'loose', NULL),
('granular-sub-base', 'Granular Sub Base (GSB)', 'aggregates', 'gsb-wmm', NULL, 'Tonne', 'Granular Sub Base', NULL,
 'gsb granular sub base road base',
 'Granular sub base material for roads and yards, sold by the tonne.',
 'Granular sub base material for the sub base layer of roads, driveways and yards. Sold loose by the tonne.',
 '{"Type": "Granular sub base"}', 'loose', NULL),
('wet-mix-macadam', 'Wet Mix Macadam (WMM)', 'aggregates', 'gsb-wmm', NULL, 'Tonne', 'Wet Mix Macadam', NULL,
 'wmm wet mix macadam road base',
 'Wet mix macadam for road and yard base layers, sold by the tonne.',
 'Wet mix macadam for the base layer of roads, driveways and yards. Sold loose by the tonne.',
 '{"Type": "Wet mix macadam"}', 'loose', NULL),
('rubble-stone', 'Rubble Stone', 'aggregates', 'rubble-boulders', NULL, 'Tonne', 'Rubble Stone', NULL,
 'rubble boulders stone size stone soling',
 'Rubble stone for masonry, soling and filling, sold by the tonne.',
 'Rubble stone for rubble masonry foundations, retaining walls, plinth filling and soling. Sold loose by the tonne.',
 '{"Type": "Rubble stone", "Material": "Natural stone"}', 'loose', NULL),

-- ---- Bricks ----
('red-clay-brick', 'Red Clay Brick', 'bricks', 'red-clay-bricks', NULL, 'Piece', 'Burnt Clay Brick', 'IS 1077',
 'brick bricks eent int red brick clay brick',
 'Common burnt clay building brick.',
 'Common burnt clay building brick conforming to IS 1077, for load bearing and partition walls and general masonry.',
 '{"Type": "Burnt clay brick", "Material": "Clay"}', 'standard', NULL),
('wire-cut-red-brick', 'Wire Cut Red Brick', 'bricks', 'red-clay-bricks', NULL, 'Piece', 'Wire Cut Clay Brick', 'IS 1077',
 'brick bricks eent int wire cut machine made brick',
 'Wire cut burnt clay building brick.',
 'Machine extruded, wire cut burnt clay building brick conforming to IS 1077, for walls and exposed brickwork.',
 '{"Type": "Wire cut burnt clay brick", "Material": "Clay"}', 'standard', NULL),
('fly-ash-brick', 'Fly Ash Brick', 'bricks', 'fly-ash-bricks', NULL, 'Piece', 'Fly Ash Brick', 'IS 12894',
 'brick bricks fly ash flyash eent int',
 'Fly ash building brick.',
 'Fly ash brick conforming to IS 12894, for load bearing and partition walls and general masonry.',
 '{"Type": "Fly ash brick", "Material": "Fly ash"}', 'standard', NULL),
('aac-block', 'AAC Block', 'bricks', 'aac-blocks', NULL, 'Piece', 'AAC Block', 'IS 2185 (Part 3)',
 'aac block autoclaved aerated concrete lightweight block',
 'Autoclaved aerated concrete block, 600 x 200 mm face.',
 'Autoclaved aerated concrete block conforming to IS 2185 (Part 3), for lightweight walls in framed buildings.',
 '{"Type": "Autoclaved aerated concrete block"}', 'standard', 'aac-block'),
('magicrete-aac-block', 'Magicrete AAC Block', 'bricks', 'aac-blocks', 'magicrete', 'Piece', 'AAC Block', 'IS 2185 (Part 3)',
 'aac block autoclaved aerated concrete lightweight block',
 'Magicrete autoclaved aerated concrete block, 600 x 200 mm face.',
 'Magicrete autoclaved aerated concrete block conforming to IS 2185 (Part 3), for lightweight walls in framed buildings.',
 '{"Type": "Autoclaved aerated concrete block"}', 'standard', 'aac-block'),
('biltech-aac-block', 'Biltech AAC Block', 'bricks', 'aac-blocks', 'biltech', 'Piece', 'AAC Block', 'IS 2185 (Part 3)',
 'aac block autoclaved aerated concrete lightweight block',
 'Biltech autoclaved aerated concrete block, 600 x 200 mm face.',
 'Biltech autoclaved aerated concrete block conforming to IS 2185 (Part 3), for lightweight walls in framed buildings.',
 '{"Type": "Autoclaved aerated concrete block"}', 'standard', 'aac-block'),
('birla-aerocon-aac-block', 'Birla Aerocon AAC Block', 'bricks', 'aac-blocks', 'birla-aerocon', 'Piece', 'AAC Block', 'IS 2185 (Part 3)',
 'aac block autoclaved aerated concrete lightweight block hil',
 'Birla Aerocon autoclaved aerated concrete block, 600 x 200 mm face.',
 'Birla Aerocon autoclaved aerated concrete block conforming to IS 2185 (Part 3), for lightweight walls in framed buildings.',
 '{"Type": "Autoclaved aerated concrete block"}', 'standard', 'aac-block'),
('solid-concrete-block', 'Solid Concrete Block', 'bricks', 'concrete-blocks', NULL, 'Piece', 'Solid Concrete Block', 'IS 2185 (Part 1)',
 'concrete block solid block cement block',
 'Solid concrete masonry block, 400 x 200 mm face.',
 'Solid concrete masonry block conforming to IS 2185 (Part 1), for load bearing, partition and compound walls.',
 '{"Type": "Solid concrete masonry block"}', 'standard', 'concrete-block'),
('hollow-concrete-block', 'Hollow Concrete Block', 'bricks', 'concrete-blocks', NULL, 'Piece', 'Hollow Concrete Block', 'IS 2185 (Part 1)',
 'concrete block hollow block cement block',
 'Hollow concrete masonry block, 400 x 200 mm face.',
 'Hollow concrete masonry block conforming to IS 2185 (Part 1), for load bearing, partition and compound walls.',
 '{"Type": "Hollow concrete masonry block"}', 'standard', 'concrete-block'),
('porotherm-hollow-clay-block', 'Porotherm Hollow Clay Block', 'bricks', 'hollow-clay-blocks', 'porotherm', 'Piece', 'Hollow Clay Block', 'IS 3952',
 'porotherm hollow clay block brick wienerberger',
 'Porotherm burnt clay hollow block.',
 'Porotherm burnt clay hollow block conforming to IS 3952, for internal and external walls in framed buildings.',
 '{"Type": "Burnt clay hollow block", "Material": "Clay"}', 'standard', NULL),
('concrete-paver-block', 'Concrete Paver Block', 'bricks', 'paver-blocks', NULL, 'SqFt', 'Concrete Paver Block', 'IS 15658',
 'paver block pavers interlocking paving',
 'Precast concrete paver block, priced per square foot.',
 'Precast concrete paver block conforming to IS 15658, for driveways, parking areas, footpaths and outdoor flooring. Priced per square foot laid.',
 '{"Type": "Precast concrete paver block"}', 'standard', 'paver-block'),

-- ---- Pipes: CPVC SDR 11 (IS 15778), Piece ----
('astral-cpvc-pipe-sdr-11', 'Astral CPVC Pipe SDR 11', 'pipes', 'cpvc-pipes', 'astral', 'Piece', 'CPVC Pipe SDR 11', 'IS 15778',
 'pipe cpvc hot water plumbing', 'Astral CPVC pipe, SDR 11, 1/2 inch to 2 inch.',
 'Astral CPVC pipe, SDR 11, conforming to IS 15778, for hot and cold water supply lines inside buildings.',
 '{"Material": "CPVC", "Grade": "SDR 11"}', 'standard', 'pipe-inch'),
('ashirvad-cpvc-pipe-sdr-11', 'Ashirvad CPVC Pipe SDR 11', 'pipes', 'cpvc-pipes', 'ashirvad', 'Piece', 'CPVC Pipe SDR 11', 'IS 15778',
 'pipe cpvc hot water plumbing', 'Ashirvad CPVC pipe, SDR 11, 1/2 inch to 2 inch.',
 'Ashirvad CPVC pipe, SDR 11, conforming to IS 15778, for hot and cold water supply lines inside buildings.',
 '{"Material": "CPVC", "Grade": "SDR 11"}', 'standard', 'pipe-inch'),
('supreme-cpvc-pipe-sdr-11', 'Supreme CPVC Pipe SDR 11', 'pipes', 'cpvc-pipes', 'supreme', 'Piece', 'CPVC Pipe SDR 11', 'IS 15778',
 'pipe cpvc hot water plumbing', 'Supreme CPVC pipe, SDR 11, 1/2 inch to 2 inch.',
 'Supreme CPVC pipe, SDR 11, conforming to IS 15778, for hot and cold water supply lines inside buildings.',
 '{"Material": "CPVC", "Grade": "SDR 11"}', 'standard', 'pipe-inch'),
('finolex-cpvc-pipe-sdr-11', 'Finolex CPVC Pipe SDR 11', 'pipes', 'cpvc-pipes', 'finolex-pipes', 'Piece', 'CPVC Pipe SDR 11', 'IS 15778',
 'pipe cpvc hot water plumbing', 'Finolex CPVC pipe, SDR 11, 1/2 inch to 2 inch.',
 'Finolex CPVC pipe, SDR 11, conforming to IS 15778, for hot and cold water supply lines inside buildings.',
 '{"Material": "CPVC", "Grade": "SDR 11"}', 'standard', 'pipe-inch'),
('prince-cpvc-pipe-sdr-11', 'Prince CPVC Pipe SDR 11', 'pipes', 'cpvc-pipes', 'prince-pipes', 'Piece', 'CPVC Pipe SDR 11', 'IS 15778',
 'pipe cpvc hot water plumbing', 'Prince CPVC pipe, SDR 11, 1/2 inch to 2 inch.',
 'Prince CPVC pipe, SDR 11, conforming to IS 15778, for hot and cold water supply lines inside buildings.',
 '{"Material": "CPVC", "Grade": "SDR 11"}', 'standard', 'pipe-inch'),

-- ---- Pipes: uPVC Schedule 40 (standard left empty, to be confirmed), Piece ----
('astral-upvc-pipe-schedule-40', 'Astral uPVC Pipe Schedule 40', 'pipes', 'upvc-pipes', 'astral', 'Piece', 'uPVC Pipe Schedule 40', NULL,
 'pipe upvc plumbing cold water sch 40', 'Astral uPVC plumbing pipe, Schedule 40, 1/2 inch to 2 inch.',
 'Astral uPVC plumbing pipe, Schedule 40, for cold water supply lines inside and outside buildings.',
 '{"Material": "uPVC", "Grade": "Schedule 40"}', 'standard', 'pipe-inch'),
('ashirvad-upvc-pipe-schedule-40', 'Ashirvad uPVC Pipe Schedule 40', 'pipes', 'upvc-pipes', 'ashirvad', 'Piece', 'uPVC Pipe Schedule 40', NULL,
 'pipe upvc plumbing cold water sch 40', 'Ashirvad uPVC plumbing pipe, Schedule 40, 1/2 inch to 2 inch.',
 'Ashirvad uPVC plumbing pipe, Schedule 40, for cold water supply lines inside and outside buildings.',
 '{"Material": "uPVC", "Grade": "Schedule 40"}', 'standard', 'pipe-inch'),
('supreme-upvc-pipe-schedule-40', 'Supreme uPVC Pipe Schedule 40', 'pipes', 'upvc-pipes', 'supreme', 'Piece', 'uPVC Pipe Schedule 40', NULL,
 'pipe upvc plumbing cold water sch 40', 'Supreme uPVC plumbing pipe, Schedule 40, 1/2 inch to 2 inch.',
 'Supreme uPVC plumbing pipe, Schedule 40, for cold water supply lines inside and outside buildings.',
 '{"Material": "uPVC", "Grade": "Schedule 40"}', 'standard', 'pipe-inch'),
('finolex-upvc-pipe-schedule-40', 'Finolex uPVC Pipe Schedule 40', 'pipes', 'upvc-pipes', 'finolex-pipes', 'Piece', 'uPVC Pipe Schedule 40', NULL,
 'pipe upvc plumbing cold water sch 40', 'Finolex uPVC plumbing pipe, Schedule 40, 1/2 inch to 2 inch.',
 'Finolex uPVC plumbing pipe, Schedule 40, for cold water supply lines inside and outside buildings.',
 '{"Material": "uPVC", "Grade": "Schedule 40"}', 'standard', 'pipe-inch'),
('prince-upvc-pipe-schedule-40', 'Prince uPVC Pipe Schedule 40', 'pipes', 'upvc-pipes', 'prince-pipes', 'Piece', 'uPVC Pipe Schedule 40', NULL,
 'pipe upvc plumbing cold water sch 40', 'Prince uPVC plumbing pipe, Schedule 40, 1/2 inch to 2 inch.',
 'Prince uPVC plumbing pipe, Schedule 40, for cold water supply lines inside and outside buildings.',
 '{"Material": "uPVC", "Grade": "Schedule 40"}', 'standard', 'pipe-inch'),

-- ---- Pipes: PVC pressure 6 kgf/cm2 (IS 4985), Piece ----
('finolex-pvc-pressure-pipe-6-kgf', 'Finolex PVC Pressure Pipe 6 kgf/cm²', 'pipes', 'pvc-pressure-pipes', 'finolex-pipes', 'Piece', 'PVC Pressure Pipe 6 kgf/cm²', 'IS 4985',
 'pipe pvc pressure pipe borewell agriculture water main', 'Finolex PVC pressure pipe, 6 kgf/cm², 63 mm to 160 mm.',
 'Finolex unplasticized PVC pressure pipe, 6 kgf/cm², conforming to IS 4985, for water mains, borewell and pumping lines and irrigation.',
 '{"Material": "PVC", "Grade": "6 kgf/cm²"}', 'standard', 'pvc-pressure'),
('supreme-pvc-pressure-pipe-6-kgf', 'Supreme PVC Pressure Pipe 6 kgf/cm²', 'pipes', 'pvc-pressure-pipes', 'supreme', 'Piece', 'PVC Pressure Pipe 6 kgf/cm²', 'IS 4985',
 'pipe pvc pressure pipe borewell agriculture water main', 'Supreme PVC pressure pipe, 6 kgf/cm², 63 mm to 160 mm.',
 'Supreme unplasticized PVC pressure pipe, 6 kgf/cm², conforming to IS 4985, for water mains, borewell and pumping lines and irrigation.',
 '{"Material": "PVC", "Grade": "6 kgf/cm²"}', 'standard', 'pvc-pressure'),
('prince-pvc-pressure-pipe-6-kgf', 'Prince PVC Pressure Pipe 6 kgf/cm²', 'pipes', 'pvc-pressure-pipes', 'prince-pipes', 'Piece', 'PVC Pressure Pipe 6 kgf/cm²', 'IS 4985',
 'pipe pvc pressure pipe borewell agriculture water main', 'Prince PVC pressure pipe, 6 kgf/cm², 63 mm to 160 mm.',
 'Prince unplasticized PVC pressure pipe, 6 kgf/cm², conforming to IS 4985, for water mains, borewell and pumping lines and irrigation.',
 '{"Material": "PVC", "Grade": "6 kgf/cm²"}', 'standard', 'pvc-pressure'),

-- ---- Pipes: SWR Type B (IS 13592), Piece ----
('astral-swr-pipe-type-b', 'Astral SWR Pipe Type B', 'pipes', 'swr-pipes', 'astral', 'Piece', 'SWR Pipe Type B', 'IS 13592',
 'pipe swr drainage soil waste rainwater', 'Astral SWR drainage pipe, Type B, 75 mm to 160 mm.',
 'Astral uPVC soil, waste and rainwater pipe, Type B, conforming to IS 13592, for drainage in buildings.',
 '{"Material": "uPVC", "Grade": "Type B"}', 'standard', 'swr'),
('ashirvad-swr-pipe-type-b', 'Ashirvad SWR Pipe Type B', 'pipes', 'swr-pipes', 'ashirvad', 'Piece', 'SWR Pipe Type B', 'IS 13592',
 'pipe swr drainage soil waste rainwater', 'Ashirvad SWR drainage pipe, Type B, 75 mm to 160 mm.',
 'Ashirvad uPVC soil, waste and rainwater pipe, Type B, conforming to IS 13592, for drainage in buildings.',
 '{"Material": "uPVC", "Grade": "Type B"}', 'standard', 'swr'),
('supreme-swr-pipe-type-b', 'Supreme SWR Pipe Type B', 'pipes', 'swr-pipes', 'supreme', 'Piece', 'SWR Pipe Type B', 'IS 13592',
 'pipe swr drainage soil waste rainwater', 'Supreme SWR drainage pipe, Type B, 75 mm to 160 mm.',
 'Supreme uPVC soil, waste and rainwater pipe, Type B, conforming to IS 13592, for drainage in buildings.',
 '{"Material": "uPVC", "Grade": "Type B"}', 'standard', 'swr'),
('finolex-swr-pipe-type-b', 'Finolex SWR Pipe Type B', 'pipes', 'swr-pipes', 'finolex-pipes', 'Piece', 'SWR Pipe Type B', 'IS 13592',
 'pipe swr drainage soil waste rainwater', 'Finolex SWR drainage pipe, Type B, 75 mm to 160 mm.',
 'Finolex uPVC soil, waste and rainwater pipe, Type B, conforming to IS 13592, for drainage in buildings.',
 '{"Material": "uPVC", "Grade": "Type B"}', 'standard', 'swr'),
('prince-swr-pipe-type-b', 'Prince SWR Pipe Type B', 'pipes', 'swr-pipes', 'prince-pipes', 'Piece', 'SWR Pipe Type B', 'IS 13592',
 'pipe swr drainage soil waste rainwater', 'Prince SWR drainage pipe, Type B, 75 mm to 160 mm.',
 'Prince uPVC soil, waste and rainwater pipe, Type B, conforming to IS 13592, for drainage in buildings.',
 '{"Material": "uPVC", "Grade": "Type B"}', 'standard', 'swr'),

-- ---- Pipes: HDPE PE 100 PN 10 (IS 4984), Metre ----
('jain-hdpe-pipe-pe-100-pn-10', 'Jain HDPE Pipe PE 100 PN 10', 'pipes', 'hdpe-pipes', 'jain-irrigation', 'Metre', 'HDPE Pipe PE 100 PN 10', 'IS 4984',
 'pipe hdpe poly pipe water line borewell', 'Jain HDPE pipe, PE 100, PN 10, 32 mm to 110 mm, priced per metre.',
 'Jain high density polyethylene pipe, PE 100, PN 10, conforming to IS 4984, for water supply mains and underground water lines. Priced per metre.',
 '{"Material": "HDPE", "Grade": "PE 100 PN 10"}', 'standard', 'hdpe'),
('hdpe-pipe-pe-100-pn-10', 'HDPE Pipe PE 100 PN 10', 'pipes', 'hdpe-pipes', NULL, 'Metre', 'HDPE Pipe PE 100 PN 10', 'IS 4984',
 'pipe hdpe poly pipe water line borewell', 'HDPE pipe, PE 100, PN 10, 32 mm to 110 mm, priced per metre.',
 'High density polyethylene pipe, PE 100, PN 10, conforming to IS 4984, for water supply mains and underground water lines. Priced per metre.',
 '{"Material": "HDPE", "Grade": "PE 100 PN 10"}', 'standard', 'hdpe'),

-- ---- Pipes: PPR PN 20 (standard left empty, to be confirmed), Piece ----
('ppr-pipe-pn-20', 'PPR Pipe PN 20', 'pipes', 'ppr-pipes', NULL, 'Piece', 'PPR Pipe PN 20', NULL,
 'pipe ppr hot water plumbing', 'PPR pipe, PN 20, 20 mm to 50 mm.',
 'Polypropylene random copolymer pipe, PN 20, for hot and cold water supply lines inside buildings.',
 '{"Material": "PPR", "Grade": "PN 20"}', 'standard', 'ppr'),

-- ---- Pipes: ductile iron (IS 8329), Metre; pressure class not stated ----
('electrosteel-castings-di-pipe', 'Electrosteel Castings Ductile Iron Pipe', 'pipes', 'di-pipes', 'electrosteel-castings', 'Metre', 'Ductile Iron Pipe', 'IS 8329',
 'pipe di ductile iron water main', 'Electrosteel Castings ductile iron pipe, DN 100 to DN 300, priced per metre.',
 'Electrosteel Castings ductile iron pipe conforming to IS 8329, for water supply mains and pumping lines. Priced per metre.',
 '{"Material": "Ductile iron"}', 'standard', 'di'),
('jindal-saw-di-pipe', 'Jindal SAW Ductile Iron Pipe', 'pipes', 'di-pipes', 'jindal-saw', 'Metre', 'Ductile Iron Pipe', 'IS 8329',
 'pipe di ductile iron water main', 'Jindal SAW ductile iron pipe, DN 100 to DN 300, priced per metre.',
 'Jindal SAW ductile iron pipe conforming to IS 8329, for water supply mains and pumping lines. Priced per metre.',
 '{"Material": "Ductile iron"}', 'standard', 'di'),

-- ---- Pipes: RCC hume pipes (IS 458), Piece ----
('rcc-np2-hume-pipe', 'RCC NP2 Hume Pipe', 'pipes', 'rcc-hume-pipes', NULL, 'Piece', 'RCC Hume Pipe NP2', 'IS 458',
 'pipe rcc hume pipe concrete pipe culvert drain np2', 'Precast RCC hume pipe, class NP2, 300 mm to 1200 mm.',
 'Precast reinforced cement concrete non-pressure pipe, class NP2, conforming to IS 458, for storm water drains, culverts and sewers.',
 '{"Material": "Reinforced cement concrete", "Grade": "NP2"}', 'standard', 'rcc-hume'),
('rcc-np3-hume-pipe', 'RCC NP3 Hume Pipe', 'pipes', 'rcc-hume-pipes', NULL, 'Piece', 'RCC Hume Pipe NP3', 'IS 458',
 'pipe rcc hume pipe concrete pipe culvert drain np3', 'Precast RCC hume pipe, class NP3, 300 mm to 1200 mm.',
 'Precast reinforced cement concrete non-pressure pipe, class NP3, conforming to IS 458, for culverts and road crossings under heavier loads.',
 '{"Material": "Reinforced cement concrete", "Grade": "NP3"}', 'standard', 'rcc-hume');

-- =============================================================================
-- 2. GUARDS: stop, writing nothing, if this database or these lists are not
--    what the script expects.
-- =============================================================================
DO $guard$
DECLARE
    v_list text;
BEGIN
    IF current_database() NOT IN ('crewnbuild', 'crewnbuild_test') THEN
        RAISE EXCEPTION 'WRONG DATABASE: connected to "%", expected "crewnbuild" or "crewnbuild_test".', current_database();
    END IF;

    SELECT string_agg(name, ', ') INTO v_list
      FROM (VALUES ('catalog_categories'), ('catalog_subcategories'), ('catalog_brands'), ('catalog_units'),
                   ('catalog_products'), ('catalog_product_variants')) AS t(name)
     WHERE to_regclass('professional.' || name) IS NULL;
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Missing table(s) professional.%. Run the Professional migrations first.', v_list;
    END IF;

    -- Units: Tonne, Piece and SqFt must already exist (the seed adds them); Metre is added here.
    SELECT string_agg(DISTINCT p.unit, ', ') INTO v_list
      FROM new_products p
     WHERE p.unit <> 'Metre'
       AND NOT EXISTS (SELECT 1 FROM professional.catalog_units u WHERE u.code = p.unit);
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Unit(s) % missing. Run python -m app.seeds.seed_master_catalog first.', v_list;
    END IF;
    IF EXISTS (SELECT 1 FROM professional.catalog_units WHERE code = 'Metre' AND unit_family IS DISTINCT FROM 'LENGTH') THEN
        RAISE EXCEPTION 'A unit "Metre" already exists with a unit_family other than LENGTH.';
    END IF;

    -- The lists must agree with each other.
    SELECT string_agg(p.slug, ', ') INTO v_list FROM new_products p
     WHERE NOT EXISTS (SELECT 1 FROM new_subcategories s WHERE s.category = p.category AND s.slug = p.subcategory)
        OR (p.brand IS NOT NULL AND NOT EXISTS (SELECT 1 FROM new_brands b WHERE b.slug = p.brand))
        OR (p.variant_set IS NOT NULL AND NOT EXISTS (SELECT 1 FROM new_variant_sets v WHERE v.set_name = p.variant_set))
        OR NOT EXISTS (SELECT 1 FROM new_policies x WHERE x.kind = p.policy);
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Product(s) naming an unlisted subcategory, brand, variant set or policy: %', v_list;
    END IF;
    SELECT string_agg(s.category || '/' || s.slug, ', ') INTO v_list FROM new_subcategories s
     WHERE NOT EXISTS (SELECT 1 FROM new_categories c WHERE c.slug = s.category)
        OR NOT EXISTS (SELECT 1 FROM new_products p WHERE p.category = s.category AND p.subcategory = s.slug);
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Subcategory(ies) with no category or no product: %', v_list;
    END IF;

    -- Lengths the supplier listing copies (supplier_listings columns).
    SELECT string_agg(p.slug, ', ') INTO v_list FROM new_products p
     WHERE length(p.name) > 160 OR length(p.product_type) > 80 OR length(p.slug) > 140
        OR length(coalesce(p.specifications ->> 'Grade', '')) > 80;
    IF v_list IS NULL THEN
        SELECT string_agg(v.set_name || '/' || v.slug, ', ') INTO v_list FROM new_variant_sets v
         WHERE length(v.name) > 80 OR length(v.slug) > 80;
    END IF;
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Too long for the catalog or listing columns: %', v_list;
    END IF;

    -- A brand slug already used by a different company.
    SELECT string_agg(b.slug || ' (is "' || x.name || '" / ' || coalesce(x.manufacturer, 'no manufacturer') || ')', ', ') INTO v_list
      FROM new_brands b JOIN professional.catalog_brands x ON x.slug = b.slug
     WHERE x.name <> b.name OR x.manufacturer IS DISTINCT FROM b.manufacturer;
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Brand slug(s) already belong to another brand: %', v_list;
    END IF;
    -- The same brand name under another slug (two "Electrosteel"s in the brand list).
    SELECT string_agg(b.name || ' (already ' || x.slug || ')', ', ') INTO v_list
      FROM new_brands b JOIN professional.catalog_brands x ON lower(x.name) = lower(b.name) AND x.slug <> b.slug;
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Brand name(s) already used by another brand: %', v_list;
    END IF;

    -- A product slug already in India's catalog somewhere else (moved, or someone else's product).
    SELECT string_agg(p.slug || ' (now in ' || coalesce(c.slug, '?') || '/' || coalesce(s.slug, '?') || ')', ', ') INTO v_list
      FROM new_products p
      JOIN professional.catalog_products x ON x.country_code = 'IN' AND x.slug = p.slug
      LEFT JOIN professional.catalog_subcategories s ON s.id = x.subcategory_id
      LEFT JOIN professional.catalog_categories c ON c.id = s.category_id
     WHERE c.slug IS DISTINCT FROM p.category OR s.slug IS DISTINCT FROM p.subcategory;
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Product slug(s) already used elsewhere in the catalog: %', v_list;
    END IF;
    -- An active product of the same name under another slug (the checks file's name rule).
    SELECT string_agg(p.name || ' (already ' || x.slug || ')', ', ') INTO v_list
      FROM new_products p
      JOIN professional.catalog_products x
        ON x.country_code = 'IN' AND x.is_active AND x.normalized_name = lower(btrim(p.name)) AND x.slug <> p.slug;
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Product name(s) already used by another active product: %', v_list;
    END IF;

    RAISE NOTICE 'Guards passed.';
END
$guard$;

-- =============================================================================
-- 3. INSERTS: only what is missing. Nothing is updated or deleted.
-- =============================================================================

-- Unit
INSERT INTO professional.catalog_units (code, name, unit_family, sort_order, is_active)
VALUES ('Metre', 'Metre', 'LENGTH', 50, true)
ON CONFLICT (code) DO NOTHING;

-- Brands (logo_url is uploaded in Admin > Master Catalog > Brands)
INSERT INTO professional.catalog_brands (slug, name, manufacturer, description, sort_order, is_active)
SELECT b.slug, b.name, b.manufacturer, b.description, b.sort_order, true
  FROM new_brands b
ON CONFLICT (slug) DO NOTHING;

-- Categories: partial unique index (country_code, slug), so WHERE NOT EXISTS
INSERT INTO professional.catalog_categories (country_code, slug, name, description, sort_order, is_active)
SELECT 'IN', c.slug, c.name, c.description, c.sort_order, true
  FROM new_categories c
 WHERE NOT EXISTS (SELECT 1 FROM professional.catalog_categories x
                    WHERE x.country_code = 'IN' AND x.slug = c.slug);

-- Subcategories
INSERT INTO professional.catalog_subcategories (category_id, slug, name, description, sort_order, is_active)
SELECT c.id, s.slug, s.name, s.description, s.sort_order, true
  FROM new_subcategories s
  JOIN professional.catalog_categories c ON c.country_code = 'IN' AND c.slug = s.category
ON CONFLICT (category_id, slug) DO NOTHING;

-- Products: partial unique index (country_code, slug), so WHERE NOT EXISTS.
-- search_keywords, highlights and faqs are built as master_catalog_seed.sql builds them.
INSERT INTO professional.catalog_products
    (country_code, subcategory_id, brand_id, slug, name, normalized_name, short_description, description,
     product_type, standard_code, unit_id, specifications, search_keywords, highlights, faqs,
     returns_exchange_policy, is_active)
SELECT 'IN', s.id, b.id, p.slug, p.name, lower(btrim(p.name)), p.short_description, p.description,
       p.product_type, p.standard, u.id, p.specifications, kw.keywords, hl.highlights, fq.faqs,
       pol.policy_text, true
  FROM new_products p
  JOIN new_subcategories ns                 ON ns.category = p.category AND ns.slug = p.subcategory
  JOIN new_policies pol                     ON pol.kind = p.policy
  JOIN professional.catalog_categories c    ON c.country_code = 'IN' AND c.slug = p.category
  JOIN professional.catalog_subcategories s ON s.category_id = c.id AND s.slug = p.subcategory
  JOIN professional.catalog_units u         ON u.code = p.unit
  LEFT JOIN professional.catalog_brands b   ON b.slug = p.brand
  -- The variant names: "Available as" and the search words.
  LEFT JOIN LATERAL (
        SELECT string_agg(vs.name, ', ' ORDER BY vs.position) AS sizes,
               string_agg(vs.name, ' ' ORDER BY vs.position)  AS names
          FROM new_variant_sets vs
         WHERE vs.set_name = p.variant_set) v ON true
  -- Search keywords: the extra words plus every name the product is known by.
  CROSS JOIN LATERAL (
        SELECT string_agg(DISTINCT lower(word), ' ') AS keywords
          FROM regexp_split_to_table(
                   concat_ws(' ', p.keywords, p.name, b.name, c.name || ' ' || s.name,
                             p.product_type, p.standard, u.name, v.names),
                   '[^[:alnum:].]+') AS word
         WHERE word <> '') kw
  -- Highlights: its use, each specification, its standard, its sizes.
  CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(h.line ORDER BY h.ord, h.sub), '[]'::jsonb) AS highlights
          FROM (SELECT 1 AS ord, 0::bigint AS sub, ns.uses AS line
                UNION ALL
                SELECT 2, e.n, e.key || ': ' || e.value
                  FROM jsonb_each_text(p.specifications) WITH ORDINALITY AS e(key, value, n)
                UNION ALL
                SELECT 3, 0, 'Conforms to ' || p.standard
                UNION ALL
                SELECT 4, 0, 'Available as: ' || v.sizes) AS h
         WHERE h.line IS NOT NULL) hl
  -- FAQs: the same questions the seed asks; one with no answer is left out.
  CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('question', f.q, 'answer', f.ans) ORDER BY f.o), '[]'::jsonb) AS faqs
          FROM (VALUES (1, 'What is ' || p.name || ' used for?', ns.uses || '.'),
                       (3, 'Where can it be applied?', (p.specifications ->> 'Application') || '.'),
                       (4, 'Which standard does it conform to?', p.standard),
                       (5, 'Which sizes is it available in?', v.sizes || '.')) AS f(o, q, ans)
         WHERE f.ans IS NOT NULL) fq
 WHERE NOT EXISTS (SELECT 1 FROM professional.catalog_products x
                    WHERE x.country_code = 'IN' AND x.slug = p.slug);

-- Variants: the product's unit, specifications as listed, sort_order 10, 20, ...
INSERT INTO professional.catalog_product_variants (product_id, slug, name, unit_id, specifications, sort_order, is_active)
SELECT x.id, vs.slug, vs.name, x.unit_id, vs.specifications, vs.position * 10, true
  FROM new_products p
  JOIN professional.catalog_products x ON x.country_code = 'IN' AND x.slug = p.slug
  JOIN new_variant_sets vs             ON vs.set_name = p.variant_set
ON CONFLICT (product_id, slug) DO NOTHING;

-- Every listed product must now sit where the list puts it, with all its variants;
-- otherwise the whole run is rolled back.
DO $after$
DECLARE
    v_list text;
BEGIN
    SELECT string_agg(p.slug, ', ') INTO v_list
      FROM new_products p
     WHERE NOT EXISTS (
            SELECT 1
              FROM professional.catalog_products x
              JOIN professional.catalog_subcategories s ON s.id = x.subcategory_id
              JOIN professional.catalog_categories c    ON c.id = s.category_id
              LEFT JOIN professional.catalog_brands b   ON b.id = x.brand_id
             WHERE x.country_code = 'IN' AND x.slug = p.slug
               AND c.country_code = 'IN' AND c.slug = p.category AND s.slug = p.subcategory
               AND ((p.brand IS NULL AND x.brand_id IS NULL) OR b.slug = p.brand))
        OR (SELECT count(*) FROM new_variant_sets vs
             WHERE vs.set_name = p.variant_set
               AND NOT EXISTS (SELECT 1 FROM professional.catalog_product_variants v
                                 JOIN professional.catalog_products x ON x.id = v.product_id
                                WHERE x.country_code = 'IN' AND x.slug = p.slug AND v.slug = vs.slug)) > 0;
    IF v_list IS NOT NULL THEN
        RAISE EXCEPTION 'Not in the catalog as listed (rolled back): %', v_list;
    END IF;
    RAISE NOTICE 'Every listed product is in place with its variants.';
END
$after$;

-- =============================================================================
-- 4. READ-ONLY CHECKS (each SELECT prints its own result)
--    Expected after a run: the numbers in the comments.
-- =============================================================================

-- 4a. Per category.  aggregates 7 / 8 / 5 / 0;  bricks 6 / 11 / 20 / 4;  pipes 8 / 25 / 132 / 8
SELECT c.slug AS category, c.name, c.sort_order, c.is_active,
       count(DISTINCT s.id) AS subcategories, count(DISTINCT p.id) AS products,
       count(DISTINCT v.id) AS variants, count(DISTINCT p.brand_id) AS brands
  FROM professional.catalog_categories c
  LEFT JOIN professional.catalog_subcategories s    ON s.category_id = c.id
  LEFT JOIN professional.catalog_products p         ON p.subcategory_id = s.id
  LEFT JOIN professional.catalog_product_variants v ON v.product_id = p.id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes')
 GROUP BY c.slug, c.name, c.sort_order, c.is_active
 ORDER BY c.sort_order;

-- 4b. Per subcategory (21 rows, every one with at least one product).
SELECT c.slug AS category, s.slug AS subcategory, s.sort_order, s.is_active,
       count(DISTINCT p.id) AS products, count(v.id) AS variants
  FROM professional.catalog_subcategories s
  JOIN professional.catalog_categories c            ON c.id = s.category_id
  LEFT JOIN professional.catalog_products p         ON p.subcategory_id = s.id
  LEFT JOIN professional.catalog_product_variants v ON v.product_id = p.id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes')
 GROUP BY c.sort_order, c.slug, s.sort_order, s.slug, s.is_active
 ORDER BY c.sort_order, s.sort_order;

-- 4c. Per brand in these categories (12 brands with 25 products, plus "(generic)" for
--     brand_id NULL: aggregates 8, bricks 7, pipes 4 = 19 products).
SELECT c.slug AS category, COALESCE(b.name, '(generic)') AS brand, b.slug, b.manufacturer,
       count(DISTINCT p.id) AS products, count(v.id) AS variants
  FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
  LEFT JOIN professional.catalog_brands b   ON b.id = p.brand_id
  LEFT JOIN professional.catalog_product_variants v ON v.product_id = p.id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes')
 GROUP BY c.sort_order, c.slug, b.sort_order, b.name, b.slug, b.manufacturer
 ORDER BY c.sort_order, b.sort_order NULLS FIRST;

-- 4d. Per product (44 rows): unit, standard, grade, variants and policy.
SELECT c.slug AS category, s.slug AS subcategory, COALESCE(b.name, '(generic)') AS brand,
       p.slug, p.name, u.code AS unit, p.standard_code, p.specifications ->> 'Grade' AS grade,
       (SELECT count(*) FROM professional.catalog_product_variants v WHERE v.product_id = p.id) AS variants,
       left(p.returns_exchange_policy, 40) AS policy_starts, p.is_active
  FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
  LEFT JOIN professional.catalog_brands b   ON b.id = p.brand_id
  LEFT JOIN professional.catalog_units u    ON u.id = p.unit_id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes')
 ORDER BY c.sort_order, s.sort_order, b.sort_order NULLS FIRST, p.name;

-- 4e. Totals at each level (expected: 1 unit Metre, 12 brands, 3, 21, 44, 157).
SELECT 'units (Metre)' AS level, count(*) AS rows FROM professional.catalog_units WHERE code = 'Metre'
UNION ALL
SELECT 'brands (new slugs)', count(*) FROM professional.catalog_brands
 WHERE slug IN ('magicrete', 'biltech', 'birla-aerocon', 'porotherm', 'astral', 'ashirvad', 'supreme',
                'finolex-pipes', 'prince-pipes', 'jain-irrigation', 'electrosteel-castings', 'jindal-saw')
UNION ALL
SELECT 'categories', count(*) FROM professional.catalog_categories
 WHERE country_code = 'IN' AND slug IN ('aggregates', 'bricks', 'pipes')
UNION ALL
SELECT 'subcategories', count(*) FROM professional.catalog_subcategories s
  JOIN professional.catalog_categories c ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes')
UNION ALL
SELECT 'products', count(*) FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes')
UNION ALL
SELECT 'variants', count(*) FROM professional.catalog_product_variants v
  JOIN professional.catalog_products p ON p.id = v.product_id
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes');

-- 4f. Products without a unit (expected: no rows).
SELECT p.slug, p.name
  FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
  LEFT JOIN professional.catalog_units u    ON u.id = p.unit_id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes') AND u.id IS NULL;

-- 4g. Subcategories without products (expected: no rows).
SELECT c.slug AS category, s.slug AS subcategory
  FROM professional.catalog_subcategories s
  JOIN professional.catalog_categories c ON c.id = s.category_id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes')
   AND NOT EXISTS (SELECT 1 FROM professional.catalog_products p WHERE p.subcategory_id = s.id);

-- 4h. Broken links in the whole India catalog (expected: no rows): a product whose
--     subcategory, category, brand or unit is missing or in another country; a variant
--     whose product or unit is missing or whose unit differs from its product's.
SELECT 'product' AS kind, p.slug, p.name,
       (s.id IS NULL) AS missing_subcategory, (c.id IS NULL OR c.country_code <> 'IN') AS bad_category,
       (p.brand_id IS NOT NULL AND b.id IS NULL) AS missing_brand,
       (p.unit_id IS NOT NULL AND u.id IS NULL) AS missing_unit, false AS unit_differs
  FROM professional.catalog_products p
  LEFT JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  LEFT JOIN professional.catalog_categories c    ON c.id = s.category_id
  LEFT JOIN professional.catalog_brands b        ON b.id = p.brand_id
  LEFT JOIN professional.catalog_units u         ON u.id = p.unit_id
 WHERE p.country_code = 'IN'
   AND (s.id IS NULL OR c.id IS NULL OR c.country_code <> 'IN'
        OR (p.brand_id IS NOT NULL AND b.id IS NULL) OR (p.unit_id IS NOT NULL AND u.id IS NULL))
UNION ALL
SELECT 'variant', v.slug, v.name, false, (p.id IS NULL), false,
       (v.unit_id IS NOT NULL AND vu.id IS NULL), (p.id IS NOT NULL AND v.unit_id IS DISTINCT FROM p.unit_id)
  FROM professional.catalog_product_variants v
  LEFT JOIN professional.catalog_products p      ON p.id = v.product_id
  LEFT JOIN professional.catalog_units vu        ON vu.id = v.unit_id
  LEFT JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  LEFT JOIN professional.catalog_categories c    ON c.id = s.category_id
 WHERE p.id IS NULL
    OR (v.unit_id IS NOT NULL AND vu.id IS NULL)
    -- the unit rule is the seed's, so it is checked only for the new categories
    OR (c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes') AND v.unit_id IS DISTINCT FROM p.unit_id);

-- 4i. Reachable from the supplier's dropdowns: active category > subcategory >
--     brand (or generic) > product (> an active variant when it has variants).
--     Expected: no rows.
SELECT p.slug, c.is_active AS category_active, s.is_active AS subcategory_active,
       b.is_active AS brand_active, p.is_active AS product_active
  FROM professional.catalog_products p
  JOIN professional.catalog_subcategories s ON s.id = p.subcategory_id
  JOIN professional.catalog_categories c    ON c.id = s.category_id
  LEFT JOIN professional.catalog_brands b   ON b.id = p.brand_id
 WHERE c.country_code = 'IN' AND c.slug IN ('aggregates', 'bricks', 'pipes')
   AND (NOT c.is_active OR NOT s.is_active OR NOT p.is_active OR (b.id IS NOT NULL AND NOT b.is_active)
        OR (EXISTS (SELECT 1 FROM professional.catalog_product_variants v0 WHERE v0.product_id = p.id)
            AND NOT EXISTS (SELECT 1 FROM professional.catalog_product_variants v
                             WHERE v.product_id = p.id AND v.is_active)));

-- 4j. Duplicates across India's catalog (expected: every row 0).
SELECT 'product slug' AS natural_key, count(*) AS duplicates
  FROM (SELECT slug FROM professional.catalog_products WHERE country_code = 'IN' GROUP BY slug HAVING count(*) > 1) d
UNION ALL
SELECT 'product name (active)', count(*)
  FROM (SELECT normalized_name FROM professional.catalog_products WHERE country_code = 'IN' AND is_active
         GROUP BY normalized_name HAVING count(*) > 1) d
UNION ALL
SELECT 'brand name', count(*)
  FROM (SELECT lower(name) FROM professional.catalog_brands GROUP BY lower(name) HAVING count(*) > 1) d;

-- Dry run: replace COMMIT with ROLLBACK.
COMMIT;

/**
 * What the city build produces and the server loads.
 *
 * Built once per city (src/data/buildCity.ts) from an OSM extract; loaded into
 * memory at server start (src/data/cityStore.ts). No map API is called at
 * request time.
 */

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface CityConfig {
  id: string;
  name: string;
  /** Geofabrik (or similar) .osm.pbf that contains the city. */
  extractUrl: string;
  bbox: BBox;
  /** Average Google rating of places in this city (for adjusted ratings); params.ratingPriorMean when missing. */
  ratingMean?: number;
  /** Where the planner benchmark draws starts and ends; the central part of bbox when missing. */
  benchArea?: BBox;
}

/**
 * Walkable street network as an undirected graph in compressed (CSR) form.
 * Every node is a point on a street (junctions and shape points alike).
 * Each edge is stored once; adjacency lists it from both ends.
 */
export interface StreetGraph {
  nodeCount: number;
  edgeCount: number;
  lat: Float64Array; // [nodeCount]
  lng: Float64Array; // [nodeCount]
  /** adjacency of node n is adjTo/adjEdge[adjStart[n] .. adjStart[n+1]) */
  adjStart: Int32Array; // [nodeCount + 1]
  adjTo: Int32Array; // [2 * edgeCount] neighbour node
  adjEdge: Int32Array; // [2 * edgeCount] edge index
  edgeLength: Float32Array; // [edgeCount] metres
  /** index into tagSets: the edge's street tags (only STREET_TAG_KEYS). */
  edgeTagSet: Int32Array; // [edgeCount]
  tagSets: Array<Record<string, string>>;
  /** OSM id of the way each edge comes from; missing in cities built before way ids were stored. */
  edgeWayId?: Float64Array; // [edgeCount]
  /** Nearest graph node within maxMeters, or -1. */
  nearestNode(lat: number, lng: number, maxMeters: number): number;
}

/** A point of interest from OSM that matches one of the iD presets. */
export interface OsmPlace {
  /** "osm:n123" / "osm:w456" */
  id: string;
  lat: number;
  lng: number;
  name: string | null;
  /** All the element's tags. */
  tags: Record<string, string>;
  /** Best matching iD preset id, e.g. "amenity/cafe". */
  presetId: string;
}

export interface CityData {
  config: CityConfig;
  graph: StreetGraph;
  places: OsmPlace[];
  /** Places whose tags contain every key=value of `tags` ("*" = any value). */
  placesMatching(tags: Record<string, string>): OsmPlace[];
}

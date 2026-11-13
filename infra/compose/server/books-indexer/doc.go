// Command kimono-books-indexer keeps Kimono Books' catalog: it fetches the
// public metadata dumps (Open Library today), keeps the compressed files, and
// loads them into Postgres for search and ISBN lookups.
package main

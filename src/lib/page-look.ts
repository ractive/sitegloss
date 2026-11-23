/**
 * The look of what Sitegloss draws on a web page (DEC-024), apart from the
 * overlay's code: the frames of the extension's own on the page (DEC-064)
 * share it.
 */

export const HOVER_COLOUR = "#1f6feb";
/**
 * The overlay's one look (DEC-024): it sits on pages Sitegloss knows nothing
 * about, so it is the same on each of them and in both colour schemes. A unit
 * test holds every pair of these to its contrast.
 */
export const PAGE_LOOK = {
	/** The toolbar and the review bar. */
	bar: "#1b2130",
	barText: "#ffffff",
	barMuted: "#c5cbd8",
	barHover: "#2f384c",
	/** The pressed tool and the bar's one main action; ink on it. */
	amber: "#ffb000",
	amberHover: "#f0a400",
	/** Under every stroke and around every pin: the edge on a dark page. */
	casing: "#ffffff",
	/** The comment's popover: white, whatever the page's scheme. */
	popover: "#ffffff",
	popoverText: "#1b2130",
	popoverMuted: "#535c6e",
	/** A placeholder on the popover's fields: lighter than text, still 4.5:1 (DEC-060). */
	popoverPlaceholder: "#6e7583",
	popoverEdge: "#7b8291",
	/** The edge of an amber button on the popover's white. */
	amberEdge: "#a06c00",
} as const;

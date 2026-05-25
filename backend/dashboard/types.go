package dashboard

// WidgetLayout is one widget's position in the 12-col grid.
type WidgetLayout struct {
	I string `json:"i"`
	X int    `json:"x"`
	Y int    `json:"y"`
	W int    `json:"w"`
	H int    `json:"h"`
}

// StoredLayout is the JSON blob persisted per user.
type StoredLayout struct {
	Version int            `json:"version"`
	Widgets []WidgetLayout `json:"widgets"`
}

// WidgetSpec is the server-side registry entry for a widget id.
// minW/minH match the frontend widgetRegistry to keep client/server in sync.
type WidgetSpec struct {
	MinW int
	MinH int
}

// KnownWidgets maps widget id → constraints. Update both this and the
// frontend widgetRegistry when adding a widget.
var KnownWidgets = map[string]WidgetSpec{
	"active":   {MinW: 4, MinH: 4},
	"quickAdd": {MinW: 3, MinH: 3},
	"storage":  {MinW: 3, MinH: 3},
	"recent":   {MinW: 3, MinH: 4},
}

const (
	GridCols           = 12
	CurrentVersion     = 1
	MaxWidgetsInLayout = 4
)

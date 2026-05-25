package dashboard

import (
	"testing"

	"github.com/hasmikatom/torrent/db"
)

func newRepo(t *testing.T) *Repository {
	t.Helper()
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := db.Migrate(d); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return NewRepository(d)
}

func validLayout() StoredLayout {
	return StoredLayout{
		Version: 1,
		Widgets: []WidgetLayout{
			{I: "active", X: 0, Y: 0, W: 8, H: 8},
			{I: "quickAdd", X: 8, Y: 0, W: 4, H: 3},
		},
	}
}

func TestGet_ReturnsNilForUnknownUser(t *testing.T) {
	r := newRepo(t)
	got, err := r.Get("u-missing")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for unknown user, got %+v", got)
	}
}

func TestUpsertThenGet_RoundTrip(t *testing.T) {
	r := newRepo(t)
	want := validLayout()
	if err := r.Upsert("u1", want); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	got, err := r.Get("u1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil {
		t.Fatal("expected layout, got nil")
	}
	if got.Version != want.Version || len(got.Widgets) != len(want.Widgets) {
		t.Fatalf("round trip mismatch: got %+v want %+v", got, want)
	}
	if got.Widgets[0].I != "active" || got.Widgets[0].W != 8 {
		t.Fatalf("widget mismatch: got %+v", got.Widgets[0])
	}
}

func TestUpsert_IsolatedPerUser(t *testing.T) {
	r := newRepo(t)
	a := validLayout()
	b := StoredLayout{Version: 1, Widgets: []WidgetLayout{{I: "storage", X: 0, Y: 0, W: 4, H: 4}}}
	if err := r.Upsert("user-a", a); err != nil {
		t.Fatal(err)
	}
	if err := r.Upsert("user-b", b); err != nil {
		t.Fatal(err)
	}
	gotA, _ := r.Get("user-a")
	gotB, _ := r.Get("user-b")
	if len(gotA.Widgets) != 2 {
		t.Fatalf("user-a clobbered: %+v", gotA)
	}
	if len(gotB.Widgets) != 1 || gotB.Widgets[0].I != "storage" {
		t.Fatalf("user-b wrong: %+v", gotB)
	}
}

func TestValidate_RejectsBadVersion(t *testing.T) {
	bad := validLayout()
	bad.Version = 2
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for version=2")
	}
}

func TestValidate_RejectsUnknownWidget(t *testing.T) {
	bad := validLayout()
	bad.Widgets[0].I = "bogus"
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for unknown widget id")
	}
}

func TestValidate_RejectsDuplicateWidget(t *testing.T) {
	bad := StoredLayout{
		Version: 1,
		Widgets: []WidgetLayout{
			{I: "active", X: 0, Y: 0, W: 8, H: 8},
			{I: "active", X: 0, Y: 8, W: 8, H: 8},
		},
	}
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for duplicate widget id")
	}
}

func TestValidate_RejectsOverflowX(t *testing.T) {
	bad := validLayout()
	bad.Widgets[0].W = 13
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for x+w > 12")
	}
}

func TestValidate_RejectsUndersizedWidget(t *testing.T) {
	bad := validLayout()
	bad.Widgets[0].W = 1 // active minW is 4
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for w < minW")
	}
}

func TestValidate_RejectsOverlap(t *testing.T) {
	bad := StoredLayout{
		Version: 1,
		Widgets: []WidgetLayout{
			{I: "active", X: 0, Y: 0, W: 8, H: 8},
			{I: "quickAdd", X: 5, Y: 5, W: 4, H: 3},
		},
	}
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for overlapping widgets")
	}
}

func TestValidate_RejectsEmptyWidgets(t *testing.T) {
	bad := StoredLayout{Version: 1, Widgets: nil}
	if err := Validate(bad); err == nil {
		t.Fatal("expected error for empty widgets")
	}
}

func TestUpsert_RejectsInvalidLayout(t *testing.T) {
	r := newRepo(t)
	bad := validLayout()
	bad.Version = 99
	if err := r.Upsert("u1", bad); err == nil {
		t.Fatal("expected Upsert to reject invalid layout")
	}
}

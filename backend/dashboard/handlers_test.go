package dashboard

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hasmikatom/torrent/db"
	"github.com/hasmikatom/torrent/middleware"
)

func newTestRouter(t *testing.T) (*gin.Engine, *Repository) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := db.Migrate(d); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	t.Cleanup(func() { d.Close() })

	repo := NewRepository(d)
	h := NewHandlers(repo)
	r := gin.New()
	api := r.Group("/", middleware.RequireUser())
	api.GET("/user/dashboard", h.Get)
	api.PUT("/user/dashboard", h.Put)
	return r, repo
}

func doReq(r *gin.Engine, method, path string, userID string, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	if userID != "" {
		req.Header.Set("X-User-Id", userID)
		req.Header.Set("X-User-Email", userID+"@x.com")
	}
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestGet_NoUserHeader_401(t *testing.T) {
	r, _ := newTestRouter(t)
	w := doReq(r, "GET", "/user/dashboard", "", nil)
	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGet_NoSavedLayout_ReturnsNull(t *testing.T) {
	r, _ := newTestRouter(t)
	w := doReq(r, "GET", "/user/dashboard", "u1", nil)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if got["layout"] != nil {
		t.Fatalf("expected layout=null, got %v", got["layout"])
	}
}

func TestPut_RoundTripsThroughGet(t *testing.T) {
	r, _ := newTestRouter(t)
	body := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{
				{"i": "active", "x": 0, "y": 0, "w": 8, "h": 8},
				{"i": "quickAdd", "x": 8, "y": 0, "w": 4, "h": 3},
			},
		},
	}
	w := doReq(r, "PUT", "/user/dashboard", "u1", body)
	if w.Code != 200 {
		t.Fatalf("PUT expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	w2 := doReq(r, "GET", "/user/dashboard", "u1", nil)
	if w2.Code != 200 {
		t.Fatalf("GET expected 200, got %d", w2.Code)
	}
	var resp struct {
		Layout *StoredLayout `json:"layout"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Layout == nil || len(resp.Layout.Widgets) != 2 {
		t.Fatalf("round trip lost data: %+v", resp.Layout)
	}
}

func TestPut_RejectsBadVersion(t *testing.T) {
	r, _ := newTestRouter(t)
	body := map[string]any{
		"layout": map[string]any{
			"version": 99,
			"widgets": []map[string]any{{"i": "active", "x": 0, "y": 0, "w": 8, "h": 8}},
		},
	}
	w := doReq(r, "PUT", "/user/dashboard", "u1", body)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestPut_RejectsUnknownWidget(t *testing.T) {
	r, _ := newTestRouter(t)
	body := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{{"i": "bogus", "x": 0, "y": 0, "w": 4, "h": 4}},
		},
	}
	w := doReq(r, "PUT", "/user/dashboard", "u1", body)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPut_RejectsOverlap(t *testing.T) {
	r, _ := newTestRouter(t)
	body := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{
				{"i": "active", "x": 0, "y": 0, "w": 8, "h": 8},
				{"i": "quickAdd", "x": 5, "y": 5, "w": 4, "h": 3},
			},
		},
	}
	w := doReq(r, "PUT", "/user/dashboard", "u1", body)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPut_PerUserIsolation(t *testing.T) {
	r, _ := newTestRouter(t)
	bodyA := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{{"i": "active", "x": 0, "y": 0, "w": 8, "h": 8}},
		},
	}
	bodyB := map[string]any{
		"layout": map[string]any{
			"version": 1,
			"widgets": []map[string]any{{"i": "storage", "x": 0, "y": 0, "w": 4, "h": 4}},
		},
	}
	if w := doReq(r, "PUT", "/user/dashboard", "alice", bodyA); w.Code != 200 {
		t.Fatalf("alice PUT: %d", w.Code)
	}
	if w := doReq(r, "PUT", "/user/dashboard", "bob", bodyB); w.Code != 200 {
		t.Fatalf("bob PUT: %d", w.Code)
	}
	wA := doReq(r, "GET", "/user/dashboard", "alice", nil)
	wB := doReq(r, "GET", "/user/dashboard", "bob", nil)
	if !bytes.Contains(wA.Body.Bytes(), []byte(`"i":"active"`)) {
		t.Fatalf("alice not isolated: %s", wA.Body.String())
	}
	if !bytes.Contains(wB.Body.Bytes(), []byte(`"i":"storage"`)) {
		t.Fatalf("bob not isolated: %s", wB.Body.String())
	}
}

func TestPut_MalformedJSON(t *testing.T) {
	r, _ := newTestRouter(t)
	req := httptest.NewRequest("PUT", "/user/dashboard", bytes.NewBufferString("not json"))
	req.Header.Set("X-User-Id", "u1")
	req.Header.Set("X-User-Email", "u1@x.com")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// plexStub returns a fake Plex server that answers /identity with the given machine id.
func plexStub(machineID string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/identity" && r.Header.Get("X-Plex-Token") == "good-tok" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"MediaContainer":{"machineIdentifier":"` + machineID + `"}}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
}

func TestPlexIdentity_ReachableServer(t *testing.T) {
	srv := plexStub("machine-xyz")
	defer srv.Close()
	id, ok := plexIdentity(srv.URL, "good-tok")
	if !ok || id != "machine-xyz" {
		t.Fatalf("expected machine-xyz/true, got %q/%v", id, ok)
	}
}

func TestPlexIdentity_BadToken(t *testing.T) {
	srv := plexStub("machine-xyz")
	defer srv.Close()
	if _, ok := plexIdentity(srv.URL, "bad-tok"); ok {
		t.Fatal("expected unreachable with bad token")
	}
}

func TestHandlePlexProbe_ReturnsFirstReachable(t *testing.T) {
	srv := plexStub("machine-xyz")
	defer srv.Close()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/plex/probe", handlePlexProbe)

	body := `{"token":"good-tok","uris":["http://127.0.0.1:1/dead","` + srv.URL + `"]}`
	req := httptest.NewRequest(http.MethodPost, "/plex/probe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var resp map[string]string
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["uri"] != srv.URL {
		t.Fatalf("expected %s, got %s", srv.URL, resp["uri"])
	}
}

func TestHandlePlexPing_RequiresHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/plex/ping", handlePlexPing)
	req := httptest.NewRequest(http.MethodGet, "/plex/ping", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 without headers, got %d", w.Code)
	}
}

func TestHandlePlexPing_Reachable(t *testing.T) {
	srv := plexStub("machine-xyz")
	defer srv.Close()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/plex/ping", handlePlexPing)
	req := httptest.NewRequest(http.MethodGet, "/plex/ping", nil)
	req.Header.Set("X-Plex-Token", "good-tok")
	req.Header.Set("X-Plex-Server-Url", srv.URL)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
}

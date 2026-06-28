package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// plexHTTPClient is reused for all Plex /identity probes. The short timeout keeps
// a slow or unreachable candidate connection from blocking the probe loop.
var plexHTTPClient = &http.Client{Timeout: 5 * time.Second}

// plexIdentity GETs <baseURL>/identity with the token and returns the server's
// machineIdentifier. ok=false means the server was unreachable or rejected the token.
func plexIdentity(baseURL, token string) (string, bool) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(baseURL, "/")+"/identity", nil)
	if err != nil {
		return "", false
	}
	req.Header.Set("X-Plex-Token", token)
	req.Header.Set("Accept", "application/json")

	resp, err := plexHTTPClient.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", false
	}
	var body struct {
		MediaContainer struct {
			MachineIdentifier string `json:"machineIdentifier"`
		} `json:"MediaContainer"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", false
	}
	return body.MediaContainer.MachineIdentifier, true
}

type plexProbeReq struct {
	Token string   `json:"token"`
	URIs  []string `json:"uris"`
}

// handlePlexProbe tries each candidate URI in order and returns the first reachable one.
// Called internally by the auth-service when a user selects a server. The candidate URIs
// come from Plex.tv's discovery response relayed by the trusted auth-service (browser-supplied
// values are stripped by the proxy), so they are not treated as arbitrary user input here.
// If this endpoint ever becomes reachable directly by browser clients, add URL scheme/host
// allowlisting to prevent SSRF.
func handlePlexProbe(c *gin.Context) {
	var req plexProbeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	for _, uri := range req.URIs {
		if id, ok := plexIdentity(uri, req.Token); ok {
			c.JSON(http.StatusOK, gin.H{"uri": uri, "machineIdentifier": id})
			return
		}
	}
	c.JSON(http.StatusBadGateway, gin.H{"error": "no reachable connection"})
}

// handlePlexPing verifies the backend can reach the user's selected Plex server,
// using the X-Plex-* headers injected by the auth-service.
func handlePlexPing(c *gin.Context) {
	token := c.GetHeader("X-Plex-Token")
	serverURL := c.GetHeader("X-Plex-Server-Url")
	if token == "" || serverURL == "" {
		c.JSON(http.StatusConflict, gin.H{"error": "plex not linked"})
		return
	}
	id, ok := plexIdentity(serverURL, token)
	if !ok {
		c.JSON(http.StatusBadGateway, gin.H{"reachable": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reachable": true, "machineIdentifier": id})
}

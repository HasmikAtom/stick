package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/chromedp/cdproto/browser"
	"github.com/chromedp/chromedp"
	"github.com/gin-gonic/gin"
	"github.com/hasmikatom/torrent/scraper"
)

func handleDownload(c *gin.Context) {
	magnetLink := c.PostForm("magnetLink")
	torrentFile, _ := c.FormFile("torrentFile")
	mediaType := c.PostForm("contentType")

	if magnetLink == "" && torrentFile == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Either magnet link or torrent file is required"})
		return
	}

	// Validate mediaType to prevent path traversal
	downloadDir, err := GetDownloadDir(mediaType)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var filename string
	var isTempFile bool
	if torrentFile != nil {
		filename = fmt.Sprintf("/tmp/%s", torrentFile.Filename)
		if err := c.SaveUploadedFile(torrentFile, filename); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save torrent file"})
			return
		}
		isTempFile = true
		defer func() {
			if isTempFile {
				os.Remove(filename)
			}
		}()
	} else {
		filename = magnetLink
	}

	args := map[string]interface{}{
		"filename":     filename,
		"download-dir": downloadDir,
	}

	result, err := client.SendRequest("torrent-add", args)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if result.Result != "success" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add torrent"})
		return
	}

	if torrentAdded, ok := result.Arguments["torrent-added"].(map[string]interface{}); ok {
		if id, ok := torrentAdded["id"].(float64); ok {
			c.JSON(http.StatusOK, gin.H{
				"message":   "Download started",
				"torrentId": int(id),
			})
			return
		}
	}

	c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get torrent ID"})
}

type BatchDownloadRequest struct {
	MagnetLinks []string `json:"magnetLinks"`
	ContentType string   `json:"contentType"`
}

type BatchDownloadResponse struct {
	TorrentIds []int    `json:"torrentIds"`
	Errors     []string `json:"errors,omitempty"`
}

func handleBatchDownload(c *gin.Context) {
	var req BatchDownloadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if len(req.MagnetLinks) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "At least one magnet link is required"})
		return
	}

	if req.ContentType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "contentType is required"})
		return
	}

	// Validate contentType to prevent path traversal
	downloadDir, err := GetDownloadDir(req.ContentType)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var torrentIds []int
	var errors []string

	for _, magnetLink := range req.MagnetLinks {
		args := map[string]interface{}{
			"filename":     magnetLink,
			"download-dir": downloadDir,
		}

		result, err := client.SendRequest("torrent-add", args)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Failed to add torrent: %v", err))
			continue
		}

		if result.Result != "success" {
			errors = append(errors, "Failed to add torrent: unsuccessful result")
			continue
		}

		if torrentAdded, ok := result.Arguments["torrent-added"].(map[string]interface{}); ok {
			if id, ok := torrentAdded["id"].(float64); ok {
				torrentIds = append(torrentIds, int(id))
			}
		}
	}

	response := BatchDownloadResponse{
		TorrentIds: torrentIds,
		Errors:     errors,
	}

	c.JSON(http.StatusOK, response)
}

func getTorrentStatus(c *gin.Context) {
	id := c.Param("id")
	var torrentId int
	fmt.Sscanf(id, "%d", &torrentId)

	args := map[string]interface{}{
		"ids": []int{torrentId},
		"fields": []string{
			"id",
			"name",
			"percentDone",
			"rateDownload",
			"totalSize",
			"addedDate",
			"doneDate",
			"status",
			"error",
			"errorString",
		},
	}

	result, err := client.SendRequest("torrent-get", args)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if torrents, ok := result.Arguments["torrents"].([]interface{}); ok && len(torrents) > 0 {
		if torrent, ok := torrents[0].(map[string]interface{}); ok {
			status, ok := ParseTorrentStatus(torrent)
			if !ok {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse torrent data"})
				return
			}
			c.JSON(http.StatusOK, status)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Torrent not found"})
}

func listTorrents(c *gin.Context) {
	id := c.Param("id")
	var torrentId int
	fmt.Sscanf(id, "%d", &torrentId)

	args := map[string]interface{}{
		"fields": []string{
			"id",
			"name",
			"percentDone",
			"rateDownload",
			"totalSize",
			"addedDate",
			"doneDate",
			"status",
			"error",
			"errorString",
		},
	}

	result, err := client.SendRequest("torrent-get", args)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	statuses := []TorrentStatus{}
	if torrents, ok := result.Arguments["torrents"].([]interface{}); ok && len(torrents) > 0 {
		for _, t := range torrents {
			if torrent, ok := t.(map[string]interface{}); ok {
				if status, ok := ParseTorrentStatus(torrent); ok {
					statuses = append(statuses, status)
				}
			}
		}
	}

	c.JSON(http.StatusOK, statuses)
}

func renameTorrent(c *gin.Context) {
	id := c.Param("id")
	var torrentId int
	fmt.Sscanf(id, "%d", &torrentId)

	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A non-empty name is required"})
		return
	}

	// Get current torrent name
	getArgs := map[string]interface{}{
		"ids":    []int{torrentId},
		"fields": []string{"name"},
	}

	getResult, err := client.SendRequest("torrent-get", getArgs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to get torrent info: %v", err)})
		return
	}

	var currentName string
	if torrents, ok := getResult.Arguments["torrents"].([]interface{}); ok && len(torrents) > 0 {
		if torrent, ok := torrents[0].(map[string]interface{}); ok {
			currentName, _ = GetString(torrent, "name")
		}
	}

	if currentName == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Torrent not found"})
		return
	}

	if currentName == req.Name {
		c.JSON(http.StatusOK, gin.H{"message": "Name unchanged"})
		return
	}

	renameArgs := map[string]interface{}{
		"ids":  []int{torrentId},
		"path": currentName,
		"name": req.Name,
	}

	renameResult, err := client.SendRequest("torrent-rename-path", renameArgs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to rename torrent: %v", err)})
		return
	}

	if renameResult.Result != "success" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Rename failed: %s", renameResult.Result)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Torrent renamed successfully"})
}

func deleteTorrent(c *gin.Context) {
	id := c.Param("id")
	var torrentId int
	fmt.Sscanf(id, "%d", &torrentId)

	deleteData := c.Query("deleteData") == "true"

	args := map[string]interface{}{
		"ids":               []int{torrentId},
		"delete-local-data": deleteData,
	}

	result, err := client.SendRequest("torrent-remove", args)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if result.Result != "success" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove torrent"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Torrent removed successfully"})
}

type StorageInfo struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Device    string `json:"device"`
	FSType    string `json:"fsType"`
	Total     uint64 `json:"total"`
	Used      uint64 `json:"used"`
	Available uint64 `json:"available"`
}

func getStorageInfo(c *gin.Context) {
	log.Printf("Storage info: running in docker=%v, hasHostFS=%v", isRunningInDocker(), hasHostFSMount())

	mounts, err := getMounts()
	if err != nil {
		log.Printf("Failed to get mounts: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read mount information"})
		return
	}

	log.Printf("Found %d mounts after filtering", len(mounts))

	storages := make([]StorageInfo, 0)

	for _, mount := range mounts {
		// MountPoint already has the correct path for statfs (including /hostfs if needed)
		info, err := getDiskUsage(mount.MountPoint)
		if err != nil {
			log.Printf("Failed to get disk usage for %s: %v", mount.MountPoint, err)
			continue
		}

		// Skip tiny filesystems (less than 100MB) - likely system mounts
		if info.Total < 100*1024*1024 {
			log.Printf("Skipping %s - too small (%d bytes)", mount.MountPoint, info.Total)
			continue
		}

		// Display path without /hostfs prefix
		displayPath := mount.MountPoint
		if strings.HasPrefix(displayPath, "/hostfs") {
			displayPath = strings.TrimPrefix(displayPath, "/hostfs")
			if displayPath == "" {
				displayPath = "/"
			}
		}

		info.Name = displayPath
		info.Path = displayPath
		info.Device = mount.Device
		info.FSType = mount.FSType
		storages = append(storages, info)
	}

	log.Printf("Returning %d storage entries", len(storages))
	c.JSON(http.StatusOK, storages)
}

func scrapePirateBay(c *gin.Context) {
	name := c.Param("name")

	u := &url.URL{
		Scheme: "https",
		Host:   "thepiratebay.org",
		Path:   "/search.php",
	}

	q := u.Query()
	q.Add("q", name)
	q.Add("all", "on")
	q.Add("search", "Pirate + Search")
	q.Add("page", "0")
	q.Add("orderby", "")

	u.RawQuery = q.Encode()

	gin.DefaultWriter.Write([]byte(u.String()))

	results, err := scraper.ScrapePirateBay(u.String())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Scraping didnt work: %v", err.Error())})
	}
	c.JSON(http.StatusOK, results)
}

func scrapeRuTracker(ctx *gin.Context) {
	name := ctx.Param("name")

	log.Println(name)

	u := &url.URL{
		Scheme: "https",
		Host:   "rutracker.org",
		Path:   "/forum/index.php",
	}

	creds := scraper.RutrackerCredentials{
		Username: c.RutrackerUsername,
		Password: c.RutrackerPassword,
	}

	log.Println(u.String())
	results, err := scraper.ScrapeRuTracker(u.String(), name, creds)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Scraping didnt work: %v", err.Error())})
		return
	}
	ctx.JSON(http.StatusOK, results)
}

func downloadFile(ctx context.Context, downloadURL string, downloadLocation string) (string, error) {
	done := make(chan browser.EventDownloadProgress, 1)
	var filename string

	chromedp.ListenTarget(ctx, func(v interface{}) {
		if ev, ok := v.(*browser.EventDownloadWillBegin); ok {
			filename = ev.SuggestedFilename
			log.Printf("Download will begin for the file: %s", filename)
		}
		if ev, ok := v.(*browser.EventDownloadProgress); ok {
			completed := "(unknown)"
			if ev.TotalBytes != 0 {
				completed = fmt.Sprintf("%0.2f%%", ev.ReceivedBytes/ev.TotalBytes*100.0)
			}
			log.Printf("Download state: %s, completed: %s\n", ev.State.String(), completed)
			if ev.State == browser.DownloadProgressStateCompleted {
				done <- *ev
				close(done)
			}
		}
	})

	if err := chromedp.Run(ctx,
		browser.
			SetDownloadBehavior(browser.SetDownloadBehaviorBehaviorAllow).
			WithDownloadPath(downloadLocation).
			WithEventsEnabled(true),
		chromedp.Navigate(downloadURL),
	); err != nil && !strings.Contains(err.Error(), "net::ERR_ABORTED") {
		return "", err
	}

	log.Println("Download initiated, waiting for completion...")

	select {
	case ev := <-done:
		downloadPath := filepath.Join(downloadLocation, ev.GUID)
		log.Printf("Download completed: %s", downloadPath)
		return filename, nil
	case <-ctx.Done():
		return "", fmt.Errorf("download timed out or context cancelled")
	}
}

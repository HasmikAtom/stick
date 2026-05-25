package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/hasmikatom/torrent/db"
	"github.com/hasmikatom/torrent/middleware"
	"github.com/hasmikatom/torrent/scraper"
	"github.com/hasmikatom/torrent/transmission"
	"github.com/joho/godotenv"
)

var c *Config
var client *transmission.TransmissionRPC

func init() {
	godotenv.Load()

	c = SetConfigs()

	client = &transmission.TransmissionRPC{
		URL:      fmt.Sprintf("http://%s:%s/transmission/rpc", c.TransmissionHost, c.TransmissionPort),
		Username: c.TransmissionUsername,
		Password: c.TransmissionPassword,
		Client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	if err := scraper.GetPool().Init(); err != nil {
		log.Printf("Warning: Failed to initialize browser pool: %v", err)
	}

	// Load scraper config
	scraper.LoadScraperConfig()
}

func main() {
	r := gin.Default()

	// Open and migrate the SQLite database
	dbPath := c.DatabasePath
	if dbPath == "" {
		dbPath = "./data/backend.sqlite"
	}
	sqlDB, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("Failed to open database at %s: %v", dbPath, err)
	}
	defer sqlDB.Close()

	if err := db.Migrate(sqlDB); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}
	log.Printf("Database ready at %s", dbPath)

	config := cors.DefaultConfig()
	config.AllowOrigins = []string{"*"}
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"}
	config.AllowHeaders = []string{"*"}

	r.Use(cors.New(config))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group("/", middleware.RequireUser())
	{
		api.POST("/download", handleDownload)
		api.POST("/download/file", handleFileDownload)
		api.POST("/download/batch", handleBatchDownload)
		api.POST("/download/file/batch", handleBatchFileDownload)

		api.POST("/download/prepare", handlePrepareDownload)
		api.POST("/download/file/prepare", handleFilePrepareDownload)
		api.POST("/download/prepare/batch", handleBatchPrepareDownload)
		api.POST("/download/file/prepare/batch", handleBatchFilePrepareDownload)
		api.GET("/download/prepare/status/:id", handlePrepareStatus)
		api.POST("/download/finalize", handleFinalizeDownload)
		api.POST("/download/cancel", handleCancelDownload)
		api.GET("/status/:id", getTorrentStatus)
		api.GET("/torrents", listTorrents)
		api.DELETE("/torrents/:id", deleteTorrent)
		api.PUT("/torrents/:id/rename", renameTorrent)
		api.GET("/storage", getStorageInfo)

		api.POST("/scrape/piratebay/:name", scrapePirateBay)
		api.POST("/scrape/rutracker/:name", scrapeRuTracker)
		api.GET("/scrape/piratebay/:name/stream", scrapePirateBaySSE)
		api.GET("/scrape/rutracker/:name/stream", scrapeRuTrackerSSE)
		api.GET("/scrape/sources", getScraperSources)
	}

	// Create server with graceful shutdown
	srv := &http.Server{
		Addr:    ":" + c.AppPort,
		Handler: r,
	}

	// Start server in goroutine
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	log.Printf("Server started on port %s", c.AppPort)

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Shutdown browser pool
	scraper.GetPool().Shutdown()

	// Give outstanding requests 5 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

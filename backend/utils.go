package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"syscall"
)

func SetConfigs() *Config {
	envPrefix := "DEV"
	if _, err := os.Stat("/.dockerenv"); err == nil || os.Getenv("DOCKER_CONTAINER") == "true" {
		// its running in docker
		envPrefix = "PROD"
	}

	return &Config{
		AppPort:              os.Getenv(fmt.Sprintf("%s_APP_PORT", envPrefix)),
		TransmissionHost:     os.Getenv(fmt.Sprintf("%s_TRANSMISSION_HOST", envPrefix)),
		TransmissionPort:     os.Getenv(fmt.Sprintf("%s_TRANSMISSION_PORT", envPrefix)),
		TransmissionUsername: os.Getenv(fmt.Sprintf("%s_TRANSMISSION_USERNAME", envPrefix)),
		TransmissionPassword: os.Getenv(fmt.Sprintf("%s_TRANSMISSION_PASSWORD", envPrefix)),
		RutrackerUsername:    os.Getenv(fmt.Sprintf("%s_RUTRACKER_USERNAME", envPrefix)),
		RutrackerPassword:    os.Getenv(fmt.Sprintf("%s_RUTRACKER_PASSWORD", envPrefix)),
		DatabasePath:         os.Getenv(fmt.Sprintf("%s_DATABASE_PATH", envPrefix)),
	}
}

// ValidMediaTypes defines allowed media type values to prevent path traversal
var ValidMediaTypes = map[string]bool{
	"Movies": true,
	"Series": true,
	"Music":  true,
}

// ValidateMediaType checks if the media type is allowed
func ValidateMediaType(mediaType string) bool {
	return ValidMediaTypes[mediaType]
}

// GetDownloadDir returns a safe download directory path
func GetDownloadDir(mediaType string) (string, error) {
	if !ValidateMediaType(mediaType) {
		return "", fmt.Errorf("invalid content type: %s", mediaType)
	}
	return "/mediastorage/" + mediaType, nil
}

func getStatusString(status int) string {
	switch status {
	case 0:
		return "Stopped"
	case 1:
		return "Check waiting"
	case 2:
		return "Checking"
	case 3:
		return "Download waiting"
	case 4:
		return "Downloading"
	case 5:
		return "Seed waiting"
	case 6:
		return "Seeding"
	default:
		return "Unknown"
	}
}

// getDiskUsage returns disk usage statistics for a given path
func getDiskUsage(path string) (StorageInfo, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return StorageInfo{}, err
	}

	total := stat.Blocks * uint64(stat.Bsize)
	available := stat.Bavail * uint64(stat.Bsize)
	used := total - available

	return StorageInfo{
		Total:     total,
		Used:      used,
		Available: available,
	}, nil
}

// Mount represents a mount point from /proc/mounts
type Mount struct {
	Device     string
	MountPoint string
	FSType     string
}

// Filesystem types to exclude (virtual/system filesystems)
var excludedFSTypes = map[string]bool{
	"proc":        true,
	"sysfs":       true,
	"devpts":      true,
	"tmpfs":       true,
	"devtmpfs":    true,
	"cgroup":      true,
	"cgroup2":     true,
	"pstore":      true,
	"securityfs":  true,
	"debugfs":     true,
	"configfs":    true,
	"fusectl":     true,
	"mqueue":      true,
	"hugetlbfs":   true,
	"autofs":      true,
	"binfmt_misc": true,
	"tracefs":     true,
	"overlay":     true,
	"nsfs":        true,
	"squashfs":    true,
	"efivarfs":    true,
	"ramfs":       true,
	"fuse.portal": true,
}

// Paths to exclude
var excludedPaths = []string{
	"/proc",
	"/sys",
	"/dev",
	"/run",
	"/snap",
	"/boot",
}

// isRunningInDocker checks if the application is running inside a Docker container
func isRunningInDocker() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return os.Getenv("DOCKER_CONTAINER") == "true"
}

// hasHostFSMount checks if /hostfs is mounted (host filesystem access)
func hasHostFSMount() bool {
	_, err := os.Stat("/hostfs")
	return err == nil
}

// getMounts reads /proc/mounts and returns relevant mount points
// When running in Docker with /hostfs mounted, it finds mounts under /hostfs
// and returns them for display without the /hostfs prefix
func getMounts() ([]Mount, error) {
	file, err := os.Open("/proc/mounts")
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var mounts []Mount
	seen := make(map[string]bool)
	inDocker := isRunningInDocker()
	hasHostFS := hasHostFSMount()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}

		device := fields[0]
		mountPoint := fields[1]
		fsType := fields[2]

		// Skip excluded filesystem types
		if excludedFSTypes[fsType] {
			continue
		}

		// When in Docker with hostfs, only look at mounts under /hostfs
		// These represent the actual host filesystems
		if inDocker && hasHostFS {
			if !strings.HasPrefix(mountPoint, "/hostfs/") && mountPoint != "/hostfs" {
				continue
			}
		}

		// Get the display path (without /hostfs prefix)
		displayPath := mountPoint
		if strings.HasPrefix(mountPoint, "/hostfs") {
			displayPath = strings.TrimPrefix(mountPoint, "/hostfs")
			if displayPath == "" {
				displayPath = "/"
			}
		}

		// Skip excluded paths (check against display path)
		skip := false
		for _, excludedPath := range excludedPaths {
			if strings.HasPrefix(displayPath, excludedPath) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}

		// Skip if we've already seen this device (avoid duplicates)
		if seen[device] {
			continue
		}
		seen[device] = true

		mounts = append(mounts, Mount{
			Device:     device,
			MountPoint: mountPoint, // Keep the actual path for statfs
			FSType:     fsType,
		})
	}

	return mounts, scanner.Err()
}

// Safe type assertion helpers to prevent panics

// GetFloat64 safely extracts a float64 from a map
func GetFloat64(m map[string]interface{}, key string) (float64, bool) {
	if v, ok := m[key]; ok {
		if f, ok := v.(float64); ok {
			return f, true
		}
	}
	return 0, false
}

// GetInt safely extracts an int from a map (handles float64 from JSON)
func GetInt(m map[string]interface{}, key string) (int, bool) {
	if f, ok := GetFloat64(m, key); ok {
		return int(f), true
	}
	return 0, false
}

// GetInt64 safely extracts an int64 from a map (handles float64 from JSON)
func GetInt64(m map[string]interface{}, key string) (int64, bool) {
	if f, ok := GetFloat64(m, key); ok {
		return int64(f), true
	}
	return 0, false
}

// GetString safely extracts a string from a map
func GetString(m map[string]interface{}, key string) (string, bool) {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s, true
		}
	}
	return "", false
}

// ParseTorrentStatus safely parses a torrent map into TorrentStatus
func ParseTorrentStatus(torrent map[string]interface{}) (TorrentStatus, bool) {
	id, idOk := GetInt(torrent, "id")
	name, nameOk := GetString(torrent, "name")
	percentDone, percentOk := GetFloat64(torrent, "percentDone")
	rateDownload, rateOk := GetInt64(torrent, "rateDownload")
	statusCode, statusOk := GetInt(torrent, "status")

	if !idOk || !nameOk || !percentOk || !rateOk || !statusOk {
		return TorrentStatus{}, false
	}

	totalSize, _ := GetInt64(torrent, "totalSize")
	addedDate, _ := GetInt64(torrent, "addedDate")

	status := TorrentStatus{
		ID:           id,
		Name:         name,
		PercentDone:  percentDone * 100,
		RateDownload: rateDownload,
		TotalSize:    totalSize,
		AddedDate:    addedDate,
		Status:       getStatusString(statusCode),
	}

	if errVal, ok := GetInt(torrent, "error"); ok {
		status.Error = errVal
	}
	if errStr, ok := GetString(torrent, "errorString"); ok {
		status.ErrorString = errStr
	}

	return status, true
}

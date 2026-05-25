package dashboard

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handlers struct {
	repo *Repository
}

func NewHandlers(repo *Repository) *Handlers {
	return &Handlers{repo: repo}
}

// Get returns the user's saved layout (or null).
func (h *Handlers) Get(c *gin.Context) {
	userID := c.GetString("userId")
	layout, err := h.repo.Get(userID)
	if err != nil {
		log.Printf("dashboard.Get user=%s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load layout"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"layout": layout})
}

type putBody struct {
	Layout StoredLayout `json:"layout"`
}

// Put validates and saves the user's layout.
func (h *Handlers) Put(c *gin.Context) {
	userID := c.GetString("userId")
	var body putBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON: " + err.Error()})
		return
	}
	if err := h.repo.Upsert(userID, body.Layout); err != nil {
		if errors.Is(err, ErrInvalidLayout) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		log.Printf("dashboard.Put user=%s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save layout"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"layout": body.Layout})
}

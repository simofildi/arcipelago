.DEFAULT_GOAL := help
COMPOSE := docker compose

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: ## Build the image
	$(COMPOSE) build

# How many generations a bounded run gets. `make run EPOCHS=5000` overrides it.
EPOCHS ?= 2000

# The interface is a page on the host and a container cannot open a browser there, so
# it is opened from here instead: a watcher waits in the background for the dashboard
# to answer while compose keeps the foreground. Compose is therefore untouched — Ctrl-C
# still stops the stack, and a bounded run still returns on its own.
OPEN = @scripts/open_when_ready.sh http://localhost:8080 &

# Two ways to decide how long a run lasts: in the interface, or on this command line.
# `up` is the one to use — it hands the decision to whoever is watching.
up: ## Seed the islands and open the interface. You choose the length and press start
	$(OPEN)
	$(COMPOSE) up --build

run: ## Skip the gate and run straight away: make run EPOCHS=2000
	$(OPEN)
	START_MODE=auto MAX_TICKS=$(EPOCHS) $(COMPOSE) up --build

fast: ## The shortest run (300 generations, ~50 s), for a quick check
	$(OPEN)
	START_MODE=auto MAX_TICKS=300 LINGER_SECONDS=15 $(COMPOSE) up --build

verify: ## Check that the run produced output and the islands exchanged migrants
	@test -s output/report.md || { echo "output/report.md missing or empty"; exit 1; }
	@test -s output/results.csv || { echo "output/results.csv missing or empty"; exit 1; }
	@python3 scripts/verify_output.py

down: ## Stop the stack, keep the output files
	$(COMPOSE) down

logs: ## Tail the island logs
	$(COMPOSE) logs -f island-1 island-2 island-3

test: ## Run the unit tests
	PYTHONPATH=src python3 -m unittest discover -s tests -v

local: ## Run every service as a local process (needs redis-server)
	bash tests/run_local.sh

clean: ## Stop everything and remove generated output
	-$(COMPOSE) down -v
	rm -f output/*.csv output/*.svg output/*.md

.PHONY: help build up run fast verify down logs test local clean

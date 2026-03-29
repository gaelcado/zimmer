.PHONY: install update doctor test ui-build ui-dev

install:
	./install.sh

update:
	./update.sh

doctor:
	./doctor.sh

test:
	. .venv/bin/activate && python -m pytest tests -q

ui-build:
	cd ui && npm run build

ui-dev:
	cd ui && npm run dev

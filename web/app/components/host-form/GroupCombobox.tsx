import { useState, useMemo, useRef, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { Search, Plus, X, ChevronDown, Check } from "lucide-react";

interface GroupComboboxProps {
  groups: Array<{ id: number; name: string }>;
  value: number | null;
  onChange: (groupId: number | null) => void;
  onCreateGroup: (name: string) => void;
}

export function GroupCombobox({ groups, value, onChange, onCreateGroup }: GroupComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === value) ?? null,
    [groups, value]
  );

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const lower = search.toLowerCase();
    return groups.filter((g) => g.name.toLowerCase().includes(lower));
  }, [groups, search]);

  const exactMatch = useMemo(
    () => groups.some((g) => g.name.toLowerCase() === search.trim().toLowerCase()),
    [groups, search]
  );

  const showCreateOption = search.trim().length > 0 && !exactMatch;

  // Focus input when popover opens
  useEffect(() => {
    if (open) {
      // Small delay to let the popover render
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    } else {
      setSearch("");
    }
  }, [open]);

  const handleSelect = (groupId: number) => {
    onChange(groupId);
    setOpen(false);
  };

  const handleCreate = () => {
    const name = search.trim();
    if (name) {
      onCreateGroup(name);
      setSearch("");
      setOpen(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn(!selectedGroup && "text-muted-foreground")}>
              {selectedGroup ? selectedGroup.name : "No group"}
            </span>
            <div className="flex items-center gap-1 ml-2 shrink-0">
              {selectedGroup && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={handleClear}
                  className="rounded-sm opacity-70 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
              <ChevronDown className="h-4 w-4 opacity-50" />
            </div>
          </Button>
        </PopoverTrigger>

        <PopoverContent className="p-0">
          {/* Search input */}
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups..."
              className="flex h-9 w-full bg-transparent py-2 pl-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Options list */}
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredGroups.length === 0 && !showCreateOption && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                No groups found.
              </div>
            )}

            {filteredGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => handleSelect(group.id)}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                  value === group.id && "bg-accent text-accent-foreground"
                )}
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  {value === group.id && <Check className="h-4 w-4" />}
                </span>
                {group.name}
              </button>
            ))}

            {/* Create option */}
            {showCreateOption && (
              <>
                {filteredGroups.length > 0 && (
                  <div className="-mx-1 my-1 h-px bg-muted" />
                )}
                <button
                  type="button"
                  onClick={handleCreate}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="h-4 w-4" />
                  Create &ldquo;{search.trim()}&rdquo;
                </button>
              </>
            )}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  );
}

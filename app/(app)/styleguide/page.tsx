'use client';

import { useState } from 'react';
import {
  Plus,
  Search,
  Trash2,
  Settings,
  Check,
  ArrowRight,
  Download,
  FileText,
  Sparkles,
  ChevronDown,
  LayoutGrid,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import {
  Display,
  Title,
  Heading,
  Eyebrow,
  Lead,
  Text,
  TextSm,
  Mono,
  Micro,
  Button,
  buttonVariants,
  IconButton,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Field,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  Switch,
  Badge,
  Banner,
  EmptyState,
  Avatar,
  Skeleton,
  Spinner,
  Separator,
  Kbd,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  PageFrame,
  SectionTitle,
  Grid,
  Split,
  FieldGrid,
  Toolbar,
  MetricCard,
  MetricRow,
  NextActionPill,
  StageRail,
  AvatarGroup,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/** A labelled block in the guide. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="scroll-mt-20">
      <div className="mb-4 flex items-center gap-3">
        <Eyebrow>{title}</Eyebrow>
        <span className="h-px flex-1 bg-line" />
      </div>
      {children}
    </section>
  );
}

const COLORS: [string, string][] = [
  ['bg', 'bg-bg'],
  ['surface', 'bg-surface'],
  ['surface-2', 'bg-surface-2'],
  ['ink', 'bg-ink'],
  ['ink-soft', 'bg-ink-soft'],
  ['ink-faint', 'bg-ink-faint'],
  ['line-strong', 'bg-line-strong'],
  ['accent', 'bg-accent'],
  ['accent-deep', 'bg-accent-deep'],
  ['sage', 'bg-sage'],
  ['amber', 'bg-amber'],
  ['rose', 'bg-rose'],
];

export default function StyleguidePage() {
  const [phase, setPhase] = useState<'design' | 'build'>('design');
  const [tab, setTab] = useState('overview');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);

  return (
    <PageFrame
      title="Component library"
      description="The single source of truth for every surface. Compose screens from these primitives — never hand-rolled markup."
      actions={
        <div className="inline-flex rounded-[var(--r)] border border-line bg-surface p-0.5">
          {(['design', 'build'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPhase(p)}
              className={cn(
                'rounded-[calc(var(--r)-2px)] px-3 py-1 text-xs font-medium transition-colors',
                phase === p ? 'bg-accent text-white' : 'text-ink-soft hover:text-ink',
              )}
            >
              {p === 'design' ? 'Warm' : 'Cool'}
            </button>
          ))}
        </div>
      }
    >
      <div data-phase={phase} className="flex flex-col gap-12">
        <Block title="Typography">
        <div className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-line bg-surface p-6">
          <Display>The quick brown fox</Display>
          <Title>Section title in Newsreader</Title>
          <Heading>A smaller serif heading</Heading>
          <Lead>An italic serif lede that introduces a block of content with a little editorial warmth.</Lead>
          <Text>
            Body copy in Spline Sans — comfortable measure, soft ink. Inline code reads as <Mono>repository/adapter</Mono>{' '}
            and the path <Mono>backend/src/db/connection.ts</Mono>.
          </Text>
          <TextSm>Smaller supporting copy for secondary information.</TextSm>
          <Micro>MICRO · timestamps, hints, metadata</Micro>
        </div>
      </Block>

      <Block title="Color">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {COLORS.map(([name, bg]) => (
            <div key={name} className="overflow-hidden rounded-[var(--r-md)] border border-line">
              <div className={cn('h-12', bg)} />
              <div className="bg-surface px-2 py-1.5">
                <Mono className="!text-[0.6875rem]">{name}</Mono>
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Buttons">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" leftIcon={<Plus />}>
              Small
            </Button>
            <Button leftIcon={<Sparkles />}>Medium</Button>
            <Button size="lg" rightIcon={<ArrowRight />}>
              Large
            </Button>
            <Button loading>Working</Button>
            <Button disabled>Disabled</Button>
            <IconButton aria-label="Settings" variant="secondary" icon={<Settings />} />
            <IconButton aria-label="Delete" variant="ghost" icon={<Trash2 />} />
          </div>
        </div>
      </Block>

      <Block title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>neutral</Badge>
          <Badge variant="accent" icon={<Sparkles />}>
            accent
          </Badge>
          <Badge variant="sage" dot>
            recorded
          </Badge>
          <Badge variant="amber" dot>
            running
          </Badge>
          <Badge variant="rose" dot>
            failed
          </Badge>
          <Badge variant="steel">frozen</Badge>
        </div>
      </Block>

      <Block title="Form controls">
        <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
          <Field label="Project name" hint="Shown across the workspace.">
            {(p) => <Input {...p} placeholder="Self-service enhancement" />}
          </Field>
          <Field label="Visibility">
            {(p) => (
              <Select defaultValue="public">
                <SelectTrigger {...p}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Password" error="At least 8 characters." className="sm:col-span-2">
            {(p) => <Input {...p} type="password" defaultValue="short" />}
          </Field>
          <Field label="Brief" className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={3} placeholder="What are we building?" />}
          </Field>
          <label className="flex items-center gap-2.5">
            <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
            <Text className="!text-sm">Administrator</Text>
          </label>
          <label className="flex items-center gap-2.5">
            <Switch checked={on} onCheckedChange={setOn} />
            <Text className="!text-sm">Voice transcription</Text>
          </label>
        </div>
      </Block>

      <Block title="Cards">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Exploration summary</CardTitle>
              <Badge variant="sage" size="sm">
                v1
              </Badge>
            </CardHeader>
            <CardContent>
              <Text>A standard card — header band, body, footer band. The default surface for grouped content.</Text>
            </CardContent>
            <CardFooter>
              <Micro>Grounds the Spec stage</Micro>
              <Button size="sm" rightIcon={<ArrowRight />}>
                Continue
              </Button>
            </CardFooter>
          </Card>
          <Card elevation="floating" interactive>
            <CardContent className="py-6">
              <Heading className="!text-base">Floating + interactive</Heading>
              <CardDescription className="mt-1">Hover me — elevation responds.</CardDescription>
            </CardContent>
          </Card>
        </div>
      </Block>

      <Block title="Banners">
        <div className="flex max-w-2xl flex-col gap-3">
          <Banner variant="info" title="Heads up" description="MMA is reachable and 91 models are available." />
          <Banner variant="success" title="Audit clean" description="No critical or high findings in pass 2." />
          <Banner variant="warning" title="Not yet configured" description="Add a provider key or sign in to Claude Code." />
          <Banner variant="danger" title="Dispatch failed" description="X-MMA-Main-Model header was missing." onDismiss={() => {}} />
        </div>
      </Block>

      <Block title="Tabs · Menu · Dialog">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <Text className="!text-sm pt-3">The overview panel.</Text>
                </TabsContent>
                <TabsContent value="activity">
                  <Text className="!text-sm pt-3">Recent activity.</Text>
                </TabsContent>
                <TabsContent value="settings">
                  <Text className="!text-sm pt-3">Settings panel.</Text>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4">
              <DropdownMenu>
                <DropdownMenuTrigger className={buttonVariants({ variant: 'secondary', size: 'md' })}>
                  Actions <ChevronDown className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => {}}>
                    <Download />
                    Export
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => {}}>
                    <FileText />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => {}}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                Open dialog
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton aria-label="Search" variant="ghost" icon={<Search />} />
                </TooltipTrigger>
                <TooltipContent>Search (⌘K)</TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Freeze this project?</DialogTitle>
              <DialogDescription>Freezing is a point of no return — the spec locks and the build phase begins.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" leftIcon={<Check />} onClick={() => setDialogOpen(false)}>
                Freeze
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Block>

      <Block title="Data display">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Avatar name="Admin" tint="#c4521e" />
                <Avatar name="Maya Adeyemi" size="md" tint="#4e7350" />
                <Avatar name="Sam" size="sm" tint="#355a74" />
              </div>
              <div className="flex items-center gap-3">
                <Spinner />
                <Separator orientation="vertical" className="h-5" />
                <Text className="!text-sm">
                  Press <Kbd>⌘</Kbd> <Kbd>K</Kbd>
                </Text>
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </CardContent>
          </Card>
          <EmptyState
            icon={<Sparkles />}
            title="No synthesis yet"
            description="Run the exploration tasks to ground the brief, and the summary appears here."
            action={<Button size="sm">Run tasks</Button>}
          />
        </div>
      </Block>

      <Block title="Control tower">
        <div className="flex flex-col gap-7">
          <div>
            <Micro className="mb-2 block">MetricRow / MetricCard — neutral · attention · zero</Micro>
            <MetricRow>
              <MetricCard label="Active" value={12} icon={<LayoutGrid />} />
              <MetricCard label="Waiting for human" value={3} tone="attention" icon={<Clock />} />
              <MetricCard label="Agents running" value={7} icon={<Sparkles />} />
              <MetricCard label="Audit issues" value={0} muted icon={<ShieldCheck />} />
            </MetricRow>
          </div>

          <div>
            <Micro className="mb-2 block">NextActionPill — attention · normal · done</Micro>
            <div className="flex flex-wrap items-center gap-3">
              <NextActionPill tone="attention">Review — 2 sections need you</NextActionPill>
              <NextActionPill tone="normal">Continue exploration</NextActionPill>
              <NextActionPill tone="done" icon={<Check />}>
                Done
              </NextActionPill>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-10">
            <div className="min-w-[240px] flex-1">
              <Micro className="mb-2 block">StageRail — done · active · pending</Micro>
              <StageRail
                segments={[
                  { status: 'done', label: 'Exploration' },
                  { status: 'active', label: 'Spec' },
                  { status: 'pending', label: 'Freeze' },
                  { status: 'pending', label: 'Build' },
                  { status: 'pending', label: 'Done' },
                ]}
              />
            </div>
            <div>
              <Micro className="mb-2 block">AvatarGroup — overlap + overflow</Micro>
              <AvatarGroup
                members={[
                  { name: 'Maya Adeyemi', tint: '#6A6F8C' },
                  { name: 'Devon Vance', tint: '#5E7C6B' },
                  { name: 'Sam Rivera', tint: '#9A6A8C' },
                  { name: 'Alex Kim', tint: '#C4521E' },
                  { name: 'Jo Tan', tint: '#355A74' },
                ]}
              />
            </div>
          </div>
        </div>
      </Block>

      <Block title="Patterns · Section">
        <SectionTitle description="A grouped block within a page." action={<Button size="sm" variant="ghost" leftIcon={<Plus />}>Add</Button>}>
          Team members
        </SectionTitle>
        <Card className="mt-3">
          <CardContent className="text-ink-soft">
            <Text className="!text-sm">Section header pattern — a serif heading, supporting copy, and an aligned action.</Text>
          </CardContent>
        </Card>
        </Block>

      <Block title="Layout">
        <div className="flex flex-col gap-7">
          <div>
            <Micro className="mb-2 block">Grid — auto-fill, reflows to fill wide screens</Micro>
            <Grid min="150px">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-[var(--r)] border border-line bg-surface px-4 py-6 text-center t-sm text-ink-soft"
                >
                  Card {i + 1}
                </div>
              ))}
            </Grid>
          </div>

          <div>
            <Micro className="mb-2 block">Toolbar — filters left, primary action right</Micro>
            <Toolbar actions={<Button size="sm" leftIcon={<Plus />}>New</Button>}>
              <Input placeholder="Search…" className="w-56" />
              <Badge variant="accent" size="sm" dot>Active</Badge>
              <Badge size="sm">All</Badge>
            </Toolbar>
          </div>

          <div>
            <Micro className="mb-2 block">Split — fluid main ∣ fixed aside (stacks below lg)</Micro>
            <Split
              asideWidth="200px"
              aside={
                <div className="h-full rounded-[var(--r)] border border-line bg-surface-2 p-4 t-sm text-ink-soft">
                  Aside
                </div>
              }
            >
              <div className="rounded-[var(--r)] border border-line bg-surface p-4 t-sm text-ink-soft">
                Main content — the fluid column that fills remaining width.
              </div>
            </Split>
          </div>

          <div>
            <Micro className="mb-2 block">FieldGrid — structured form fields</Micro>
            <FieldGrid cols={2}>
              <Field label="Display name">{(p) => <Input {...p} placeholder="Maya Adeyemi" />}</Field>
              <Field label="Username">{(p) => <Input {...p} placeholder="maya" />}</Field>
              <div className="sm:col-span-2">
                <Field label="Bio">{(p) => <Textarea {...p} rows={2} placeholder="Short bio…" />}</Field>
              </div>
            </FieldGrid>
          </div>
        </div>
      </Block>
      </div>
    </PageFrame>
  );
}
